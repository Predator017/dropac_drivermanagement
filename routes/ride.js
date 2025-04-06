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
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${userLat},${userLon}&destination=${driverLat},${driverLon}&mode=driving&units=metric&sensor=false&key=${apiKey}`;

  try {
    // Fetch data from Google Maps API (await fetch)
    const response = await fetch(url);
    const data = await response.json(); // Wait for JSON parsing

    if (data.routes?.[0]?.legs?.[0]) {
      const distanceInMeters = data.routes[0].legs[0].distance.value;  // This is in meters
    
    // Convert distance to kilometers
    const distanceInKilometers = distanceInMeters / 1000;  // Convert meters to kilometers

    // Optionally, you can format the result to a specific decimal point for readability
    const formattedDistance = distanceInKilometers.toFixed(3);  
      console.log(formattedDistance);
      return formattedDistance;
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
  let consumerTag = null;
  let rideAssigned = false;

  try {
    const driver = await Driver.findById(riderId);
    driver.online = true;
    await driver.save();

    const channel = getChannel();
    const queueName = outStation ? "outstation-ride-requests" : "ride-requests";

    await channel.assertQueue(queueName, { durable: true });

    console.log(`Driver ${riderId} is listening for ride requests...`);

    const consumePromise = new Promise(async (resolve, reject) => {
      try {
        consumerTag = await channel.consume(
          queueName,
          async (msg) => {
            
            if (!msg) return;

            const rideRequest = JSON.parse(msg.content.toString());

            // **Ensure ride requests are always in "ready" state**
            if (msg.fields.deliveryTag) {
              
              console.log(`Ride ${rideRequest._id} was unacked, returning it to queue.`);
                try{
                  if (
                    channel &&
                    channel.connection &&
                    channel.connection.stream.writable &&
                    !channel.connection.closing &&
                    channel._channel &&
                    channel._channel.connection &&
                    !channel._channel.connection.closing &&
                    typeof msg.fields.deliveryTag === "number"
                  ) {
                  await channel.nack(msg, false, true);
              } else {
                  const opened_channel = getChannel();
                  await opened_channel.assertQueue(queueName, { durable: true });
                  await opened_channel.nack(msg, false, true);

                  console.log("Channel is already closed. Opened new channel to put ride back");
                }
            }
            catch (error) {
              console.error("Error while nacking message:", error);
              console.trace();
          }
            
            }

            // check the vehicle type of driver and ride is same or not


            if ((rideRequest.vehicleType === "Bike" && 
              (driver.bodyDetails === "Bike" || driver.bodyDetails === "Scooter")) ||
             
             (rideRequest.vehicleType === "3-Wheeler" && 
              (driver.bodyDetails === "Electric 3 Wheeler" || driver.bodyDetails === "3 Wheeler")) ||
             
              (rideRequest.vehicleType === "Tata Ace" && 
                driver.bodyDetails.startsWith("7 Feet")) ||
               
               (rideRequest.vehicleType === "8ft Truck" && 
                driver.bodyDetails.startsWith("8 Feet")) ||
               
               (rideRequest.vehicleType === "9ft Truck" && 
                driver.bodyDetails.startsWith("9 Feet"))){

            // Calculate distance between driver and user
            const distance = await calculateDistance(
              [rideRequest.pickupDetails.pickupLat, rideRequest.pickupDetails.pickupLon],
              driverLocation.coordinates
            );

            console.log(`Driver ${riderId} is ${distance} km away from user.`);

            if (distance <= 10 /* && !isRideInCache(rideCache, riderId, rideRequest._id) */) {
              console.log(`Driver ${riderId} is within range. Assigning ride.`);

              rideAssigned = true;

              if (!res.headersSent) {
                res.status(200).json({ message: "Ride request assigned", rideRequest });
              }

             

              resolve();
            } else {
              console.log(`Driver ${riderId} is too far. Requeuing ride request.`);
                  try{
                    if (
                      channel &&
                      channel.connection &&
                      channel.connection.stream.writable &&
                      !channel.connection.closing &&
                      channel._channel &&
                      channel._channel.connection &&
                      !channel._channel.connection.closing 
                    )
                     {
                    await channel.nack(msg, false, true);
                }
              }
              catch (error) {
                const opened_channel = getChannel();
                  await opened_channel.assertQueue(queueName, { durable: true });
                  await opened_channel.nack(msg, false, true);

                  console.log("Channel is already closed. Opened new channel to put ride back");
                console.error("Error while nacking message:", error);
                console.trace();
            }
              resolve();
            }

            // **If driver doesn't act within 10 sec, requeue the ride**
            setTimeout(() => {
              if (!rideAssigned && msg.fields && msg.fields.deliveryTag) {
                  console.log(`Driver ${riderId} did not respond. Returning ride request to queue.`);
                  try{
                    if (
                      channel &&
                      channel.connection &&
                      channel.connection.stream.writable &&
                      !channel.connection.closing &&
                      channel._channel &&
                      channel._channel.connection &&
                      !channel._channel.connection.closing 
                    )
                     {
                    channel.nack(msg, false, true);
                } else {
                  console.log("Channel is already closed.");
                }
              }
              catch (error) {
                console.error("Error while nacking message:", error);
                console.trace();
            }
              }
          }, 10000);   // **Wait 10 seconds before requeuing**

        }
          },
          { noAck: false } // **Manual acknowledgment control**
        );
      } catch (error) {
        reject(error);
      }
    });

    // **Timeout if no ride is assigned within 10 sec**
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        if (!rideAssigned && !res.headersSent) {
          console.log(`No suitable ride found for driver ${riderId} within timeout.`);
          res.status(404).json({ message: "No suitable ride found within the radius" });
        }
        resolve();
      }, 10000);
    });

    // **Wait for a ride to be found or timeout**
    await Promise.race([consumePromise, timeoutPromise]);

    // **Always cancel the consumer after processing**
    if (consumerTag && consumerTag.consumerTag) {
      try {
        if (channel.connection.stream.writable) {
          await channel.cancel(consumerTag.consumerTag);
      }
      
        console.log(`Consumer for driver cancelled successfully.`);
      } catch (cancelError) {
        console.error(`Error cancelling consumer for driver :`, cancelError);
      }
    }

  } catch (error) {
    console.error("Error in assign-ride:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Ride Assignment failed", error });
    }

    // **Even if an error occurs, cancel the consumer**
    if (consumerTag && consumerTag.consumerTag) {
      try {
        const channel = getChannel();
        if (channel.connection.stream.writable) {
          await channel.cancel(consumerTag.consumerTag);
      }
      
        console.log(`Consumer for driver cancelled after error.`);
      } catch (cancelError) {
        console.error(`Error cancelling consumer for driver after error:`, cancelError);
        console.trace();
      }
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
    if (!ride || ride.status == "cancelled") {
      return res.status(404).json({ message: "Ride not found." });
    }
    if (ride.status === "confirmed") {
      // 🔹 Remove the ride from queue when another driver sees it's confirmed
      try {
        await removeRideFromQueue(queueName, rideId);
      } catch (error) {
        console.error("Error removing already confirmed ride from queue:", error);
      }
      return res.status(400).json({ message: "Ride already confirmed by another driver." });
    }

    if((ride.outStation === true && outStation === false) || (ride.outStation === false && outStation === true)) {
      return res.status(404).json({ message: "Please pass the outStation param correctly" });
    }

    // 🔹 Step 2: Confirm the ride in DB first
    const driver = await Driver.findById(riderId);
    ride.status = "confirmed";
    ride.driverId = riderId;
    ride.driverName = driver.name;
    ride.vehicleNumber = driver.vehicleNumber;
    ride.otp = Math.floor(1000 + Math.random() * 9000);
    ride.confirmedAt = moment().format("YYYY-MM-DD HH:mm:ss");
    await ride.save();
   
    // 🔹 Step 3: Remove from queue
    try {
      await removeRideFromQueue(queueName, rideId);
    } catch (error) {
      console.error("Error removing ride from queue:", error);
    }
    
    // 🔹 Step 4: Return response
    return res.status(200).json({ message: "Ride confirmed successfully", ride });
  } catch (error) {
    console.error("Error confirming ride:", error);
    return res.status(500).json({ message: "Error confirming ride", error });
  }
});

// Optimized function to remove ride from queue
async function removeRideFromQueue(queueName, targetRideId) {
  return new Promise(async (resolve, reject) => {
    try {
      const channel = getChannel();
      await channel.assertQueue(queueName, { durable: true });

      let foundTargetRide = false;
      let processedCount = 0;

      console.log(`Checking queue ${queueName} for ride ${targetRideId}`);

      while (true) {
        const msg = await channel.get(queueName, { noAck: false }); // Fetch message without removing it

        if (!msg) break; // No more messages in queue

        try {
          const rideRequest = JSON.parse(msg.content.toString());

          if (rideRequest._id === targetRideId) {
            // ✅ Ride found - Remove it from the queue
            channel.ack(msg);
            foundTargetRide = true;
            console.log(`✅ Ride ${targetRideId} removed from queue ${queueName}`);
            break; // Stop once we find and remove the ride
          } else {
            // 🚀 Requeue the message instantly for other drivers
            try{
              if (
                channel &&
                channel.connection &&
                channel.connection.stream.writable &&
                !channel.connection.closing &&
                channel._channel &&
                channel._channel.connection &&
                !channel._channel.connection.closing 
              ) {
             await channel.nack(msg, false, true);
          } else {
            const opened_channel = getChannel();
            await opened_channel.assertQueue(queueName, { durable: true });
            await opened_channel.nack(msg, false, true);

            console.log("Channel is already closed. Opened new channel to put ride back");
          }
        }
        catch (error) {
          console.error("Error while nacking message:", error);
          console.trace();
      }
          }
        } catch (error) {
          console.error("Error processing message:", error);
          try{
            if (
              channel &&
              channel.connection &&
              channel.connection.stream.writable &&
              !channel.connection.closing &&
              channel._channel &&
              channel._channel.connection &&
              !channel._channel.connection.closing 
            ) {
           await channel.nack(msg, false, true);
        } else {
          const opened_channel = getChannel();
          await opened_channel.assertQueue(queueName, { durable: true });
          await opened_channel.nack(msg, false, true);

          console.log("Channel is already closed. Opened new channel to put ride back");
        } // Return the message if error occurs
      }
      catch (error) {
        console.error("Error while nacking message:", error);
        console.trace();
    }
        }

        processedCount++;
      }

      console.log(`Processed ${processedCount} messages. Found target ride: ${foundTargetRide}`);

      if (!foundTargetRide) {
        console.log(`Ride ${targetRideId} may be in unack state! Force rejecting.`);
        await forceRejectUnacknowledgedRide(queueName, targetRideId);
      }

      resolve(foundTargetRide);
    } catch (error) {
      console.error("Error in removeRideFromQueue:", error);
      reject(error);
    }
  });
}

// Forcefully remove ride even if it's unacknowledged
async function forceRejectUnacknowledgedRide(queueName, targetRideId) {
  try {
    const channel = getChannel();
    await channel.assertQueue(queueName, { durable: true });

    channel.prefetch(1); // Ensure only one message is processed at a time

    const consumerTag = await channel.consume(queueName, (msg) => {
      if (msg) {
        const rideRequest = JSON.parse(msg.content.toString());
        if (rideRequest._id === targetRideId) {
          // 🚀 Forcefully reject without requeuing
          channel.reject(msg, false);
          console.log(`Ride ${targetRideId} forcefully removed from queue.`);
        } else {
          try{
            if (
              channel &&
              channel.connection &&
              channel.connection.stream.writable &&
              !channel.connection.closing &&
              channel._channel &&
              channel._channel.connection &&
              !channel._channel.connection.closing 
            ) {
           channel.nack(msg, false, true);
        } else {

          console.log("Channel is already closed. ");
        } // Requeue other rides
      }
      catch (error) {
        console.error("Error while nacking message:", error);
        console.trace();
    }
        }
      }
    });

    // Cancel the consumer to free up resources
    setTimeout(() => {
      if (
        channel &&
        channel.connection &&
        channel.connection.stream.writable &&
        !channel.connection.closing &&
        channel._channel &&
        channel._channel.connection &&
        !channel._channel.connection.closing 
      )  {
        
        try {
          const channel = getChannel();
          if (
            channel &&
            channel.connection &&
            channel.connection.stream.writable &&
            !channel.connection.closing &&
            channel._channel &&
            channel._channel.connection &&
            !channel._channel.connection.closing 
          )  {
            channel.cancel(consumerTag.consumerTag);
        }
        
          console.log(`Consumer for driver  cancelled after error.`);
        } catch (cancelError) {
          console.error(`Error cancelling consumer for driver after error:`, cancelError);
          console.trace();
        }
    }
    
    }, 5000);
  } catch (error) {
    console.error("Error in forceRejectUnacknowledgedRide:", error);
  }
}









router.post("/go-offline", async (req, res) => {
  const { riderId } = req.body;
  const channel = getChannel();

  await Driver.findByIdAndUpdate(riderId, { online: false });
  // Check if the consumer exists in the cache
  return res.status(200).json({ message: `Driver ${riderId} has gone offline.` });
  
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
    if (JSON.stringify(nextDrop) !== "{}" && nextDrop != null) {
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

        driver.orders +=1;
        

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


function sanitizeRideForQueue(ride) {
  const base = {
    _id: ride._id,
    userId: ride.userId,
    vehicleType: ride.vehicleType,
    pickupDetails: ride.pickupDetails,
    dropDetails1: ride.dropDetails1,
    outStation: ride.outStation,
    currentDropNumber: ride.currentDropNumber,
    fare: ride.fare,
    distance: ride.distance,
    duration: ride.duration,
    status: "pending",
    createdAt: ride.createdAt,
    timeoutAt: ride.timeoutAt,
    __v: ride.__v // Add this if frontend expects it
  };

  if (
    ride.dropDetails2 &&
    typeof ride.dropDetails2 === "object" &&
    Object.keys(ride.dropDetails2).length > 0
  ) {
    base.dropDetails2 = ride.dropDetails2;
  }

  if (
    ride.dropDetails3 &&
    typeof ride.dropDetails3 === "object" &&
    Object.keys(ride.dropDetails3).length > 0
  ) {
    base.dropDetails3 = ride.dropDetails3;
  }

  return base;
}


// Handle ride cancellation
router.post("/cancel-ride", async (req, res) => {
  const { riderId, rideId, reasonForCancellation } = req.body;

  try {
    const ride = await Ride.findById(rideId);
   
    if(ride && ride.status == 'confirmed'){

      await CancelledRidesByDriver.findOneAndUpdate(
        { driverId: riderId }, // Match the document by driverId
        { 
          $push: { 
            rides: {
              rideId: rideId,
              reasonForCancellation: reasonForCancellation,
              cancelledAt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss")
            } 
          } 
        },
        { new: true, upsert: true } // Create a new document if it doesn't exist
      );
    

      const channel = getChannel();
      
      
   
      


      ride.status = 'pending';
      ride.createdAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
      ride.timeoutAt = moment().tz("Asia/Kolkata").add(10, "minutes").format("YYYY-MM-DD HH:mm:ss");

      ride.driverId = undefined;
      ride.driverName = undefined;
      ride.vehicleNumber = undefined;
      ride.otp = undefined;
      ride.confirmedAt = undefined;

      const queueName = ride.outStation ? "outstation-ride-requests" : "ride-requests";

      // Ensure it's a plain object and doesn't contain Mongoose stuff
      const plainRide = sanitizeRideForQueue(ride);


      try {
        await channel.assertQueue(queueName, { durable: true });

        const pushed = channel.sendToQueue(
          queueName,
          Buffer.from(JSON.stringify(plainRide)),
          {
            expiration: (10 * 60 * 1000).toString(),
            persistent: true
          }
        );

        if (pushed) {
          console.log("✅ Ride successfully pushed to queue:", queueName);
        } else {
          console.error("❌ Failed to push ride to queue:", queueName);
        }

        await ride.save();
      } catch (queueErr) {
        console.error("❌ Error pushing ride to queue:", queueErr.message);
      }
      // If the ride is still valid, return its status
      return res.status(200).json({ message: "Ride request cancelled successfully", ride });
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

    return res.status(200).json({ message: "Ride cancelled, requeued for other drivers", ride });
    }
  } catch (error) {
    return res.status(500).json({ message: "Error cancelling ride", error });
  }
});

module.exports = router;
