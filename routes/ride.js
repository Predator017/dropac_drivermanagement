const express = require("express");
const { getChannel } = require("../rabbitmq");
const Ride = require("../models/Ride");
const Driver = require("../models/driver");
const moment = require('moment-timezone');


const NodeCache = require("node-cache");
const { CancelledRidesByDriver, CompletedRidesByDriver, CompletedRidesByUser } = require("../models/driverridedata");

const consumerCache = new NodeCache(); // Initialize NodeCache
let rideCache = new NodeCache({ stdTTL: 600 });




function addRideToCache(cache, riderId, rideId) {
  // Retrieve the existing array for the riderId from the cache
  let rideArray = cache.get(riderId) || [];

  // Add the rideId to the array if it doesn't already exist
  if (!rideArray.includes(rideId)) {
    rideArray.push(rideId);
    cache.set(riderId, rideArray); // Update the cache with the new array
    console.log(`Added ride ${rideId} for rider ${riderId} in the cache.`);
  } else {
    console.log(`Ride ${rideId} already exists for rider ${riderId} in the cache.`);
  }
}


function isRideInCache(cache, riderId, rideId) {
  const rideArray = cache.get(riderId) || [];
  return rideArray.includes(rideId);
}






// Helper function to calculate distance (you can replace this with a better formula)


async function calculateDistance(userCoordinates, driverCoordinates) {
  const [userLat, userLon] = userCoordinates;
  const [driverLat, driverLon] = driverCoordinates;

  const apiKey = process.env.MAPS_API; // Ensure your API key is set correctly
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${userLat},${userLon}&destination=${driverLat},${driverLon}&mode=driving&sensor=false&key=${apiKey}`;

  try {
    // Fetch data from Google Maps API (await fetch)
    const response = await fetch(url);
    const data = await response.json(); // Wait for JSON parsing

    if (data.routes?.[0]?.legs?.[0]) {
      const distanceText = data.routes[0].legs[0].distance.text; // Distance as a string (e.g., "12.5 km")
      console.log(distanceText);
      const distanceInKm = parseFloat(distanceText.replace(" km", "")); // Convert to number
      return distanceInKm;
    } else {
      throw new Error("No route found");
    }
  } catch (error) {
    console.error("Error fetching distance from Google Maps API:", error);

    // Fallback to Haversine formula if API fails
    return haversineDistance(userLat, userLon, driverLat, driverLon);
  }
}

// Haversine Formula (Fallback)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}


function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

const router = express.Router();

// Function to listen for ride requests
// Function to listen for ride requests
// Function to listen for ride requests
router.post("/assign-ride", async (req, res) => {
  const { riderId, outStation, driverLocation } = req.body;

  const driver = await Driver.findById(riderId);
  driver.online = true;
  await driver.save();

  try {
    const channel = getChannel();
    const queueName = outStation ? "outstation-ride-requests" : "ride-requests";
    let sentRideReq = false;

    // Ensure queue exists
    await channel.assertQueue(queueName, { durable: true });

    console.log(`Driver ${riderId} is now listening for ride requests...`);

    let consumerTag;

    consumerTag = await channel.consume(
      queueName,
      async (msg) => {
        if (!msg) return;

        const rideRequest = JSON.parse(msg.content.toString());

        // Track ride request attempts per driver
        if (!rideCache[riderId]) rideCache[riderId] = {};
        rideCache[riderId][rideRequest._id] =
          (rideCache[riderId][rideRequest._id] || 0) + 1;

        // If the same request is sent more than once, cancel it
        if (rideCache[riderId][rideRequest._id] > 1) {
          console.log(
            `Driver ${riderId} received ride request too many times. Cancelling.`
          );

          // ✅ Return message to queue immediately (prevents unacked state)
          channel.reject(msg, true);

          delete rideCache[riderId][rideRequest._id];
          if (consumerTag?.consumerTag) {
            await channel.cancel(consumerTag.consumerTag);
          }
          return;
        }

        // Calculate distance between driver and user
        const distance = await calculateDistance(
          [rideRequest.pickupDetails.pickupLat, rideRequest.pickupDetails.pickupLon],
          driverLocation.coordinates
        );

        console.log(`Distance to user: ${distance} km`);

        if (distance <= 10) {
          console.log(
            `Driver ${riderId} is within 10 km. Sending the ride request.`
          );
          if (!res.headersSent) {
            sentRideReq = true;
            res.status(200).json({ message: "Ride request sent to driver", rideRequest });
          }
        }

        // ✅ Always return message to the queue if not processed
        channel.reject(msg, true); // Moves the message back to "ready" queue
      },
      { noAck: false } // ❗ Keeps messages under manual acknowledgment control
    );

    if (sentRideReq) {
      if (consumerTag?.consumerTag) {
        await channel.cancel(consumerTag.consumerTag);
      }
    }
  } catch (error) {
    console.error("Error in assign-ride:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Ride Assignment failed", error });
    }
  }
});




// Confirm ride function
router.post("/confirm-ride", async (req, res) => {
  const { riderId, rideId, outStation } = req.body;

  try {
    const queueName = outStation ? "outstation-ride-requests" : "ride-requests";

    // 🔹 Step 1: Check if ride is already confirmed
    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: "Ride not found." });
    }
    if (ride.status === "confirmed") {
      // 🔹 Remove the ride from queue in the background when another driver sees it's confirmed
      removeRideFromQueue(queueName, rideId);
      return res.status(400).json({ message: "Ride already confirmed by another driver." });
    }

    // 🔹 Step 2: Confirm the ride in DB first

    const driver = await Driver.findById(riderId);

    ride.status = "confirmed";
    ride.driverId = riderId;
    ride.driverName = driver.name;
    ride.vehicleType = driver.vehicleType;
    ride.vehicleNumber = driver.vehicleNumber;
    ride.otp = Math.floor(1000 + Math.random() * 9000);
    ride.confirmedAt = new Date();
    await ride.save();

    

    // 🔹 Step 3: Return response immediately
    return res.status(200).json({ message: "Ride confirmed successfully", ride });

  } catch (error) {
    console.error("Error confirming ride:", error);
    return res.status(500).json({ message: "Error confirming ride", error });
  }
});

// 🔹 Remove the ride from queue in the background
async function removeRideFromQueue(queueName, rideId) {
  setImmediate(async () => {
    try {
      const channel = getChannel();
      let msg;
      while ((msg = await channel.get(queueName, { noAck: false }))) {
        const rideRequest = JSON.parse(msg.content.toString());
        if (rideRequest._id === rideId) {
          channel.ack(msg); // ✅ Remove from queue
          console.log(`Ride ${rideId} removed from queue.`);
          return; // Exit loop once ride is removed
        } else {
          channel.nack(msg, false, true); // Put non-matching messages back
        }
      }
    } catch (error) {
      console.error("Error removing ride from queue:", error);
    }
  });
}







router.post("/go-offline", async (req, res) => {
  const { riderId } = req.body;
  const channel = getChannel();

  await Driver.findByIdAndUpdate(riderId, { online: false });
  // Check if the consumer exists in the cache
  if (!consumerCache.has(riderId)) {
    return res.status(200).json({ message: `Driver ${riderId} has gone offline.` });
  }

  try {
    // Retrieve and cancel the consumer
    const consumerTag = consumerCache.get(riderId);
    await channel.cancel(consumerTag);

    // Remove the consumer tag from the cache
    consumerCache.del(riderId);

    console.log(`Consumer for driver ${riderId} canceled successfully.`);
    res.status(200).json({ message: `Driver ${riderId} has gone offline.` });
  } catch (error) {
    console.error("Error canceling consumer:", error);
    res.status(500).json({ message: "Failed to cancel the consumer.", error });
  }
});





router.post("/start-ride", async (req, res) => {
  const { rideId, otp } = req.body;

  try {
    const ride = await Ride.findById(rideId);
   
    if(ride && ride.status == 'confirmed'){

      if (ride.otp !== otp) {
        return res.status(400).json({ message: "Invalid OTP. Please try again." });
      }

      ride.status = 'started';
      await ride.save();

      res.status(200).json({ message: "Ride started successfully", ride });
    }

  } catch (error) {
    res.status(500).json({ message: "Error starting ride", error });
  }
});



router.post("/complete-ride", async (req, res) => {
  const { rideId, riderId } = req.body;

  try {
    const ride = await Ride.findById(rideId);

    if (!ride || ride.status !== "started" ) {
      return res.status(400).json({ message: "Invalid ride status or ride not found." });
    }

    // Determine the current drop details based on `currentDropNumber`
    let currentDrop;
    let nextDrop; 
    switch (ride.currentDropNumber) {
      case "drop1":
        currentDrop = ride.dropDetails1;
        nextDrop = ride.dropDetails2;
        break;
      case "drop2":
        currentDrop = ride.dropDetails2;
        nextDrop = ride.dropDetails3;
        break;
      case "drop3":
        currentDrop = ride.dropDetails3;
        nextDrop = null;
        break;
      default:
        return res.status(400).json({ message: "Invalid current drop number." });
    }

    // Check if the driver is within 500 meters of the current drop location
    /* const isNearDrop = calculateDistance(driverLocation.coordinates, [currentDrop.dropLat, currentDrop.dropLon]);

    if (isNearDrop>1) {
      return res.status(400).json({
        message: `You are not within 1 km of ${ride.currentDropNumber}. Please move closer to the drop location and try again.`,
      });
    }
 */
    
    // Proceed based on whether there's a next drop
    if (JSON.stringify(nextDrop) !== "{}") {
      // Update currentDropNumber to the next drop
      const presentDropNumber = ride.currentDropNumber;
      ride.currentDropNumber = nextDrop === ride.dropDetails2 ? "drop2" : "drop3";
      ride.driverId = riderId;
      await ride.save();

      return res.status(200).json({
        message: `Ride at ${presentDropNumber} completed. Now proceeding to the next drop.`,
        ride,
      });
    }

    await CompletedRidesByDriver.findOneAndUpdate(
      { driverId: riderId }, // Match the document by userId
      { $addToSet: { rideIds: rideId } }, // Add rideId to the array (only if it doesn't already exist)
      { new: true, upsert: true } // Create a new document if it doesn't exist
    );

    await CompletedRidesByUser.findOneAndUpdate(
      { userId: ride.userId }, // Match the document by userId
      { $addToSet: { rideIds: rideId } }, // Add rideId to the array (only if it doesn't already exist)
      { new: true, upsert: true } // Create a new document if it doesn't exist
    );


    // If no next drop, mark ride as completed
    ride.status = "completed";
    ride.driverId = riderId;
    ride.completedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    await ride.save();

    return res.status(200).json({ message: "Ride fully completed successfully.", ride });
  } catch (error) {
    console.error("Error completing ride:", error);
    res.status(500).json({ message: "Error completing ride", error });
  }
});


router.put('/payment-status/:rideId', async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.rideId);
        if (ride.paymentStatus == true) return res.status(200).json({ status: 'Payment already updated for this ride' });
        const driver = await Driver.findById(ride.driverId);
        if (!ride) return res.status(404).json({ error: 'Ride not found' });

        ride.paymentStatus = req.body.status;
        ride.driverShare = (ride.fare)*0.82;
        ride.dropacShare = (ride.fare)*0.18;
        await ride.save();


        const todayDate = new Date().toISOString().split("T")[0]; // Get today's date in YYYY-MM-DD format
    
        // Call the existing API internally
        const response = await fetch(`https://dropac-drivermanagement.onrender.com/api/driver-rides/transaction/${ride.driverId}/${todayDate}`);
        const data = await response.json();


        const { rides, walletBalance } = data;

        const fare = ride.fare;
        const part80 = fare * 0.82;
        const part20 = fare * 0.18;

        if (rides.length === 0) {
          driver.walletBalance.part80 = 0;
        }
        

        driver.walletBalance.total += fare;
        driver.walletBalance.part80 += part80;
        driver.walletBalance.part20 += part20;

        await driver.save();

        res.status(200).json({ message: 'Payment status updated successfully', ride });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update payment status', details: error.message });
    }
});

router.get("/get-ridestatus", async(req, res)=>{
  const { rideId } = req.body;
  try {
    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

  

    // If the ride is still valid, return its status
    res.status(200).json({ message: "Ride status retrieved successfully", ride });
  } catch (error) {
    res.status(500).json({ message: "Retrieving ride status failed", error });
  }

});


router.get('/all-transactions/:driverId', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set today's start time to midnight

    // Fetch rides excluding today's transactions
    const rides = await Ride.find({
        driverId: req.params.driverId,
        status: "completed",
        createdAt: { $lt: today.toISOString() } // Fetch only rides before today
    })
    .sort({ createdAt: -1 }); // Sort in descending order (newest first)

    // Fetch driver document
    const driver = await Driver.findById(req.params.driverId);
    if (!driver) {
        return res.status(404).json({ error: 'Driver not found' });
    }

    // Access walletBalance from driver document
    const walletBalance = driver.walletBalance;

    // Combine rides and walletBalance into a single response object
    res.status(200).json({ rides, walletBalance });
} catch (error) {
    res.status(500).json({ error: 'Failed to retrieve rides', details: error.message });
}
});

router.get('/transaction/:driverId/:date', async (req, res) => {
  try {
      const date = new Date(req.params.date);
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      // Fetch rides with createdAt stored as a string
      const rides = await Ride.aggregate([
          {
              $match: {
                  driverId: req.params.driverId,
                  status: "completed",
                  $expr: {
                      $and: [
                          { $gte: [{ $dateFromString: { dateString: "$createdAt" } }, date] },
                          { $lt: [{ $dateFromString: { dateString: "$createdAt" } }, nextDate] }
                      ]
                  }
              }
          }
      ]).sort({ createdAt: -1 });

      // Fetch driver document
      const driver = await Driver.findById(req.params.driverId);
      if (!driver) {
          return res.status(404).json({ error: 'Driver not found' });
      }

      // Access walletBalance from driver document
      const walletBalance = driver.walletBalance;

      // Combine rides and walletBalance into a single response object
      res.status(200).json({ rides, walletBalance });
  } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve rides', details: error.message });
  }
});







router.post("/rate-user", async(req, res) =>{
    const {rideId, rating} = req.body;
    try {
      const ride = await Ride.findById(rideId);
      if (!ride) {
        return res.status(404).json({ message: "Ride not found" });
      }
  
      ride.ratingByDriver = rating;
      await ride.save();
  
      // If the ride is still valid, return its status
      res.status(200).json({ message: "Thanks for your rating, we appreciate that :)", ride });
    } catch (error) {
      res.status(500).json({ message: "Something went wrong, please try again later", error });
    }

});


// Handle ride cancellation
router.post("/cancel-ride", async (req, res) => {
  const { riderId, rideId, reasonForCancellation } = req.body;

  try {
    const ride = await Ride.findById(rideId);
   
    if(ride && ride.status == 'confirmed'){

      await CancelledRidesByDriver.findOneAndUpdate(
        { driverId : riderId }, // Match the document by userId
        { $addToSet: { rideIds: rideId } }, // Add rideId to the array (only if it doesn't already exist)
        { new: true, upsert: true } // Create a new document if it doesn't exist
      );
    

      ride.status = 'cancelled';
      ride.cancelledBy = 'driver';
      ride.reasonForCancellation = reasonForCancellation;
      ride.cancelledAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");;
      ride.timeoutAt = null;
      await ride.save();

      // If the ride is still valid, return its status
      res.status(200).json({ message: "Ride request cancelled successfully", ride });
    }

    // Requeue the ride request in RabbitMQ for other drivers
    /* const channel = getChannel();
    await channel.assertQueue("ride-requests", { durable: true });

    // Publish the ride request as persistent
    await channel.sendToQueue("ride-requests", Buffer.from(JSON.stringify(ride)), { persistent: true });

    console.log("Ride request sent back to the queue:", ride); */

    // Mark this driver as unavailable for this request (so they won't receive it again)
    /* const driver = await Driver.findById(riderId); // Assuming the driver is a user
    driver.unavailableRequests.push(ride.userId);
    await driver.save(); */

    // Mark ride status as cancelled
    if(ride && ride.status == 'pending'){

      await CancelledRidesByDriver.findOneAndUpdate(
        { driverId : riderId }, // Match the document by userId
        { $addToSet: { rideIds: rideId } }, // Add rideId to the array (only if it doesn't already exist)
        { new: true, upsert: true } // Create a new document if it doesn't exist
      );
    
    addRideToCache(rideCache, riderId, rideId);

    res.status(200).json({ message: "Ride cancelled, requeued for other drivers", ride });
    }
  } catch (error) {
    res.status(500).json({ message: "Error cancelling ride", error });
  }
});

module.exports = router;
