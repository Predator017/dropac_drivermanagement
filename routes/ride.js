const express = require("express");
const { getChannel } = require("../rabbitmq");
const Ride = require("../models/Ride");
const Driver = require("../models/driver");
const moment = require('moment-timezone');


const NodeCache = require("node-cache");


let rideCache = new NodeCache({ stdTTL: 600 });

let ignoredCache = new NodeCache({ stdTTL: 600 });



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


function getIgnoredRidesFromCache(cache, riderId) {
  // Retrieve the ignored rides array for the riderId from the cache
  const rideArray = cache.get(riderId) || [];  // Return empty array if not found

  console.log(`Fetched ignored rides for rider ${riderId}:`, rideArray);
  return rideArray;
}



// Helper function to calculate distance (you can replace this with a better formula)
function calculateDistance(userCoordinates, driverCoordinates) {
  const [userLat, userLon] = userCoordinates;
  const [driverLat, driverLon] = driverCoordinates;

  const R = 6371; // Radius of the Earth in km
  const dLat = deg2rad(driverLat - userLat);
  const dLon = deg2rad(driverLon - userLon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(userLat)) * Math.cos(deg2rad(driverLat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

const router = express.Router();

// Function to listen for ride requests
router.post("/assign-ride", async (req, res) => {
  const { riderId, driverLocation } = req.body; // Expected format { latitude, longitude }
  const channel = getChannel();

  // Ensure the "ride-requests" queue exists (global queue for all ride requests)
  

  try {
    // Ensure the "ride-requests" queue exists
    await channel.assertQueue("ride-requests", { durable: true });
    const tempQueue = "temp-ride-requests";

    // Ensure a temporary queue exists
    await channel.assertQueue(tempQueue, { durable: true });

    console.log("Processing expired ride requests...");

    let msg;
    do {
      // Retrieve a message from the queue
      msg = await channel.get("ride-requests", { noAck: false });

      if (msg) {
        const rideRequest = JSON.parse(msg.content.toString());

        // Check if the rideRequest has expired
        if (new Date() > new Date(rideRequest.timeoutAt)) {
          // Acknowledge the message and remove it from the queue
          channel.ack(msg);
          console.log(`Expired ride request with ID ${rideRequest._id} removed from the queue.`);
        } else {
          // Move unexpired messages to the temporary queue
          await channel.sendToQueue(tempQueue, Buffer.from(msg.content.toString()));
          channel.ack(msg);
        }
      }
    } while (msg);

    console.log("Finished processing expired ride requests. Restoring unexpired rides...");

    // Move messages back to the original queue
    let tempMsg;
    do {
      tempMsg = await channel.get(tempQueue, { noAck: false });
      if (tempMsg) {
        await channel.sendToQueue("ride-requests", Buffer.from(tempMsg.content.toString()));
        channel.ack(tempMsg);
      }
    } while (tempMsg);

    console.log("All unexpired rides restored to the original queue.");
  } catch (error) {
    console.error("Error while processing expired ride requests:", error);
  }


  await channel.assertQueue("ride-requests", { durable: true });

  console.log(`Driver ${riderId} is now listening for ride requests...`);


  let rideProcessed = false; // Flag to ensure only one ride request is processed

  // Consume ride requests
  await channel.consume("ride-requests", async (msg) => {
    if (rideProcessed) {
      // If a ride is already processed, requeue the current message for other drivers
      channel.nack(msg, false, true);
      return;
    }

    const rideRequest = JSON.parse(msg.content.toString());

    // Calculate the distance between the user and the driver
    const distance = calculateDistance(
      rideRequest.userLocation.coordinates,
      driverLocation.coordinates
    );
    console.log(`Distance to user: ${distance} km`);

    if (distance <= 22 && !isRideInCache(rideCache, riderId, rideRequest._id)) {
      // If the driver is within 10 km, process the ride request
      console.log(`Driver ${riderId} is within 10 km. Accepting the ride request.`);

      addRideToCache(ignoredCache, riderId, rideRequest);
      // Send the ride request details to the driver
      if (!res.headersSent) {
        res.status(200).json({
          message: "Ride request sent to driver",
          rideRequest,
        });
      }

      // Acknowledge the message (remove it from the queue)
      channel.ack(msg);
      rideProcessed = true; // Mark as processed
      console.log(`Driver ${riderId} processed the ride request.`);

      // Cancel the consumer to stop further message processing
      // Cancel the consumer tag inside the callback where `consume` is triggered
      await channel.cancel(msg.fields.consumerTag);
      console.log(`Driver ${riderId} has stopped listening.`);
    } else {
      console.log(
        `Driver ${riderId} is too far from user ${rideRequest.userId}. Requeuing the request.`
      );

      // Requeue the message for other drivers to process
      channel.nack(msg, false, true);
    }
  }, { noAck: false }); // Ensure explicit acknowledgment or negative acknowledgment
});


router.post("/ignored-ride", async (req, res) => {
  const { riderId } = req.body;
  
  try {
    // Fetch ignored rides from the cache
    const ignoredRides = getIgnoredRidesFromCache(ignoredCache, riderId);

    // If no ignored rides found, respond with an empty array
    if (!ignoredRides || ignoredRides.length === 0) {
      return res.status(200).json({ message: "No ignored rides found for this driver." });
    }

    const channel = await getChannel();
    
    // Ensure the "ride-requests" queue exists
    await channel.assertQueue("ride-requests", { durable: true });

    // Loop through ignored rides and send them back to the queue
    ignoredRides.forEach(rideRequest => {
      // Assuming that the ride data (like rideId) is available in the cache,
      // You will need to have the full ride data to send to the queue.
        // Adjust based on your actual logic

      // Send ride request back to RabbitMQ
      channel.sendToQueue("ride-requests", Buffer.from(JSON.stringify(rideRequest)));
      console.log(`Re-added ignored ride ${rideRequest._id} to ride-requests queue.`);
    });

    // Optionally, clear the ignoredCache after processing
    ignoredCache.del(riderId);

    res.status(200).json({
      message: `Successfully re-added ${ignoredRides.length} ignored rides to the queue.`,
    });
  } catch (error) {
    console.error("Error re-adding ignored rides:", error);
    res.status(500).json({ message: "Failed to re-add ignored rides", error });
  }
});
// Handle ride confirmation
router.post("/confirm-ride", async (req, res) => {
  const { riderId, rideId } = req.body;

  try {
    const ride = await Ride.findById(rideId);
    if (!ride || ride.status !== 'pending') {
      return res.status(400).json({ message: "Invalid ride status or ride not found." });
    }

    // Save the ride with driver info
    ride.status = 'confirmed';
    ride.driverId = riderId;
    ride.otp = Math.floor(1000 + Math.random() * 9000);
    ride.confirmedAt = moment().tz("Asia/Kolkata").toDate();
    ride.timeoutAt = null;
    await ride.save();

    res.status(200).json({ message: "Ride confirmed successfully", ride });
  } catch (error) {
    res.status(500).json({ message: "Error confirming ride", error });
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


// Handle ride cancellation
router.post("/cancel-ride", async (req, res) => {
  const { riderId, rideId } = req.body;

  try {
    const ride = await Ride.findById(rideId);
    if (!ride || ride.status !== 'pending') {
      return res.status(400).json({ message: "Invalid ride status or ride not found." });
    }

    // Requeue the ride request in RabbitMQ for other drivers
    const channel = getChannel();
    await channel.assertQueue("ride-requests", { durable: true });

    // Publish the ride request as persistent
    await channel.sendToQueue("ride-requests", Buffer.from(JSON.stringify(ride)), { persistent: true });

    console.log("Ride request sent back to the queue:", ride);

    // Mark this driver as unavailable for this request (so they won't receive it again)
    /* const driver = await Driver.findById(riderId); // Assuming the driver is a user
    driver.unavailableRequests.push(ride.userId);
    await driver.save(); */

    // Mark ride status as cancelled
    addRideToCache(rideCache, riderId, rideId);

    res.status(200).json({ message: "Ride cancelled, requeued for other drivers", ride });
  } catch (error) {
    res.status(500).json({ message: "Error cancelling ride", error });
  }
});

module.exports = router;
