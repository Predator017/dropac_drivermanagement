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
  const { riderId, outStation, driverLocation } = req.body; // Expected format { latitude, longitude }

    //const driver = await Driver.findById(riderId);

    //const driverLocation = driver.location && driver.location.coordinates;

    try{

  

  if(outStation){
    const channel = getChannel();

  let sentRideReq = false;
    await channel.assertQueue("outstation-ride-requests", { durable: true });

  console.log(`Driver ${riderId} is now listening for ride requests...`);

  // Check if the driver is already listening
  
  // Start consuming ride requests
  const consumerTag = await channel.consume(
    "outstation-ride-requests",
    async (msg) => {
      if (!msg) {
        console.log("No messages in the queue.");
        return;
      }

      const rideRequest = JSON.parse(msg.content.toString());

      // Calculate the distance between the user and the driver
      const distance = calculateDistance(
        [rideRequest.pickupDetails.pickupLat, rideRequest.pickupDetails.pickupLon],
        driverLocation.coordinates
      );
      console.log(`Distance to user: ${distance} km`);

      if (distance <= 10 && !isRideInCache(rideCache, riderId, rideRequest._id)) {
        console.log(`Driver ${riderId} is within 10 km. Sending the ride request.`);

        // Send the ride request details to the driver
        if (!res.headersSent) {
          sentRideReq = true;
          res.status(200).json({
            message: "Ride request sent to driver",
            rideRequest,
          });
        }

        // Do not remove the message from the queue; requeue it for other drivers
        channel.nack(msg, false, true);
      } else {
        console.log(
          `Driver ${riderId} is too far from user ${rideRequest.userId}. Requeuing the request.`
        );

        // Requeue the message for other drivers to process
        channel.nack(msg, false, true);
      }
    },
    { noAck: false }
  );

  // Store the consumer tag in NodeCache
  consumerCache.set(riderId, consumerTag.consumerTag);
  console.log(`Consumer started for driver ${riderId} with tag ${consumerTag.consumerTag}`);

  if(sentRideReq){
    await channel.cancel(consumerTag.consumerTag);

    // Remove the consumer tag from the cache
    consumerCache.del(riderId);
  }

  }

  

  else{


    
  // Ensure the "ride-requests" queue exists (global queue for all ride requests)
  await channel.assertQueue("ride-requests", { durable: true });

  console.log(`Driver ${riderId} is now listening for ride requests...`);

  // Check if the driver is already listening
 /*  if (consumerCache.has(riderId)) {
    return res
      .status(400)
      .json({ message: "Driver is already listening for ride requests." });
  } */

  // Start consuming ride requests
  const consumerTag = await channel.consume(
    "ride-requests",
    async (msg) => {
      if (!msg) {
        console.log("No messages in the queue.");
        return;
      }

      const rideRequest = JSON.parse(msg.content.toString());

      // Calculate the distance between the user and the driver
      const distance = calculateDistance(
        [rideRequest.pickupDetails.pickupLat, rideRequest.pickupDetails.pickupLon],
        driverLocation.coordinates
      );
      console.log(`Distance to user: ${distance} km`);

      if (distance <= 10 && !isRideInCache(rideCache, riderId, rideRequest._id)) {
        console.log(`Driver ${riderId} is within 10 km. Sending the ride request.`);

        // Send the ride request details to the driver
        if (!res.headersSent) {
          sentRideReq = true;
          res.status(200).json({
            message: "Ride request sent to driver",
            rideRequest,
          });
        }

        // Do not remove the message from the queue; requeue it for other drivers
        channel.nack(msg, false, true);
      } else {
        console.log(
          `Driver ${riderId} is too far from user ${rideRequest.userId}. Requeuing the request.`
        );

        // Requeue the message for other drivers to process
        channel.nack(msg, false, true);
      }
    },
    { noAck: false }
  );

  // Store the consumer tag in NodeCache
  consumerCache.set(riderId, consumerTag.consumerTag);
  console.log(`Consumer started for driver ${riderId} with tag ${consumerTag.consumerTag}`);

  if(sentRideReq){
    await channel.cancel(consumerTag.consumerTag);

    // Remove the consumer tag from the cache
    consumerCache.del(riderId);
  }

}

  
    }
    catch (error) {
      res.status(500).json({ message: "Ride Assignment failed", error });
    }
});



router.post("/go-offline", async (req, res) => {
  const { riderId } = req.body;
  const channel = getChannel();

  // Check if the consumer exists in the cache
  if (!consumerCache.has(riderId)) {
    return res
      .status(400)
      .json({ message: "Driver is not currently listening for ride requests." });
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






// Handle ride confirmation
router.post("/confirm-ride", async (req, res) => {
  const { riderId, rideId, outStation } = req.body;
  const channel = getChannel();

  try {
    // Ensure the "ride-requests" queue exists

    if(outStation){
      await channel.assertQueue("outstation-ride-requests", { durable: true });

      let rideFound = false; // Flag to track if the ride is found in the queue
      let msg;
  
      // Loop through the messages in the queue to find the rideId
      do {
        msg = await channel.get("outstation-ride-requests", { noAck: false });
  
        if (msg) {
          const rideRequest = JSON.parse(msg.content.toString());
  
          if (rideRequest._id === rideId) {
            // Ride found in the queue, acknowledge (delete) it
            channel.ack(msg);
            rideFound = true;
            break;
          } else {
            // Requeue the message for other drivers to process
            channel.nack(msg, false, true);
          }
        }
      } while (msg);
  
      if (!rideFound) {
        // Ride not found in the queue, return an appropriate response
        return res.status(400).json({
          message: "You missed the ride. It has already been confirmed by another rider.",
        });
      }
  
      // Proceed to confirm the ride in the database
      const ride = await Ride.findById(rideId);
      if (!ride || ride.status !== "pending") {
        return res.status(400).json({ message: "Invalid ride status or ride not found." });
      }
  
      // Save the ride with driver info
      ride.status = "confirmed";
      ride.driverId = riderId;
      ride.otp = Math.floor(1000 + Math.random() * 9000);
      ride.confirmedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
      ride.timeoutAt = null;
      await ride.save();
  
      res.status(200).json({ message: "Ride confirmed successfully", ride });
    }
    else{
      await channel.assertQueue("ride-requests", { durable: true });

    let rideFound = false; // Flag to track if the ride is found in the queue
    let msg;

    // Loop through the messages in the queue to find the rideId
    do {
      msg = await channel.get("ride-requests", { noAck: false });

      if (msg) {
        const rideRequest = JSON.parse(msg.content.toString());

        if (rideRequest._id === rideId) {
          // Ride found in the queue, acknowledge (delete) it
          channel.ack(msg);
          rideFound = true;
          break;
        } else {
          // Requeue the message for other drivers to process
          channel.nack(msg, false, true);
        }
      }
    } while (msg);

    if (!rideFound) {
      // Ride not found in the queue, return an appropriate response
      return res.status(400).json({
        message: "You missed the ride. It has already been confirmed by another rider.",
      });
    }

    // Proceed to confirm the ride in the database
    const ride = await Ride.findById(rideId);
    if (!ride || ride.status !== "pending") {
      return res.status(400).json({ message: "Invalid ride status or ride not found." });
    }

    // Save the ride with driver info
    ride.status = "confirmed";
    ride.driverId = riderId;
    ride.otp = Math.floor(1000 + Math.random() * 9000);
    ride.confirmedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    ride.timeoutAt = null;
    await ride.save();

    res.status(200).json({ message: "Ride confirmed successfully", ride });
    }
  } catch (error) {
    console.error("Error confirming ride:", error);
    res.status(500).json({ message: "Error confirming ride", error });
  }
});


router.post("/complete-ride", async (req, res) => {
  const { rideId, riderId, driverLocation } = req.body;

  try {
    const ride = await Ride.findById(rideId);

    if (!ride || ride.status !== "confirmed") {
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
