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
    await channel.assertQueue(queueName, {
      durable: true,
      
    });

    console.log(`Driver ${riderId} is now listening for ride requests...`);

    let consumerTag; 

      consumerTag  = await channel.consume(queueName, async (msg) => {
      if (!msg) return;

      const rideRequest = JSON.parse(msg.content.toString());

      // Track ride request attempts per driver
      if (!rideCache[riderId]) rideCache[riderId] = {};
      rideCache[riderId][rideRequest._id] = (rideCache[riderId][rideRequest._id] || 0) + 1;

      // If the same request is sent more than once, cancel it
      if (rideCache[riderId][rideRequest._id] > 1) {
        //console.log(`Driver ${riderId} received ride request too many times. Cancelling.`);

        // ❗ Explicitly nack the message before cancelling the consumer
        channel.nack(msg, false, true); // ✅ This moves message back to ready state

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
        console.log(`Driver ${riderId} is within 10 km. Sending the ride request.`);
        if (!res.headersSent) {
          sentRideReq = true;
          res.status(200).json({ message: "Ride request sent to driver", rideRequest });
        }
      }

      // ❗ Always nack the message to ensure it's available for other drivers
      channel.nack(msg, false, true); // ✅ Moves the message back to the ready queue

    }, { noAck: false }); // ❗ Set `noAck: false` so we have control over message acknowledgment

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
    const channel = getChannel();
    const queueName = outStation ? "outstation-ride-requests" : "ride-requests";

    // 🔹 Check if the ride is already confirmed in the database
    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: "Ride not found." });
    }
    if (ride.status === "confirmed") {
      return res.status(400).json({ message: "Ride already confirmed by another driver." });
    }

    // 🔹 Ensure queue exists
    await channel.assertQueue(queueName, {
      durable: true,
      
    });

    let msg = await channel.get(queueName, { noAck: false });

    // 🔹 If no messages were found, recover unacked messages and retry once
    if (!msg) {
      console.log("No pending messages. Recovering unacked messages...");
      await channel.recover();
      msg = await channel.get(queueName, { noAck: false });
    }

    if (!msg) {
      return res.status(400).json({
        message: "You missed the ride. It has already been confirmed by another driver.",
      });
    }

    const rideRequest = JSON.parse(msg.content.toString());

    if (rideRequest._id === rideId) {
      // ✅ Confirm the ride
      ride.status = "confirmed";
      ride.driverId = riderId;
      ride.otp = Math.floor(1000 + Math.random() * 9000);
      ride.confirmedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
      ride.timeoutAt = null;
      await ride.save();

      channel.ack(msg); // ✅ Acknowledge the message so it's removed from queue

      return res.status(200).json({ message: "Ride confirmed successfully", ride });
    } else {
      channel.nack(msg, false, true); // Put it back in queue
    }

    return res.status(400).json({
      message: "You missed the ride. It has already been confirmed by another driver.",
    });

  } catch (error) {
    console.error("Error confirming ride:", error);
    res.status(500).json({ message: "Error confirming ride", error });
  }
});





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

    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

    if (ride.status !== "confirmed") {
      return res.status(400).json({ message: "Ride cannot be started. Invalid status." });
    }

    if (ride.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP. Please try again." });
    }

    // OTP is correct, start the ride
    ride.status = "started";
    await ride.save();

    res.status(200).json({ message: "Ride started successfully", ride });
  } catch (error) {
    console.error("Error starting ride:", error);
    res.status(500).json({ message: "Error starting ride", error });
  }
});



router.post("/complete-ride", async (req, res) => {
  const { rideId, riderId, driverLocation } = req.body;

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
    const isNearDrop = calculateDistance(driverLocation.coordinates, [currentDrop.dropLat, currentDrop.dropLon]);

    if (isNearDrop>1) {
      return res.status(400).json({
        message: `You are not within 1 km of ${ride.currentDropNumber}. Please move closer to the drop location and try again.`,
      });
    }

    
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
