const { sendToQueue, consumeFromQueue } = require('./rabbitmq');
const Trip = require('./models/trip');
const axios = require('axios');
//const { sendPushNotification } = require('./sendPushnotification');

// Assign driver to trip
async function assignDriver(trip) {
    console.log('Assigning driver to trip:', trip._id);
    if (!(trip instanceof Trip)) {
        trip = new Trip(trip);
    }
    // Query Geolocation Service to find nearby drivers
    const response = await axios.get(`http://192.168.1.3:3030/api/geolocation/nearby-drivers`, {
        params: { lat: trip.pickupLocation.coordinates[1], lng: trip.pickupLocation.coordinates[0] }
    });

    const nearbyDrivers = response.data;
    console.log('Nearby drivers:', nearbyDrivers);

    // Flatten the grouped object into an array of drivers
    const drivers = Object.values(nearbyDrivers).flat();
    console.log('Flattened drivers:', drivers);


    if (drivers.length > 0) {
        const driver = drivers[0]; // Select the nearest driver

        // Update trip with assigned driver
        trip.driverId = driver._id;
        trip.status = 'assigned';

        // Check if the trip already exists
        const existingTrip = await Trip.findById(trip._id);
        if (existingTrip) {
            // Update the existing trip
            existingTrip.driverId = trip.driverId;
            existingTrip.status = trip.status;
            await existingTrip.save();
        } else {
            // Save the new trip
            await trip.save();
        }

        // Send push notification to the driver
        // here i want to send whole trip object to driver
        await sendPushNotification(driver._id, 'New trip assignment', 'You have a new trip request. Please accept or reject.', trip);

        // Publish trip assignment to RabbitMQ
        await sendToQueue('trip-assignments', JSON.stringify(trip));
        console.log('Driver assigned and trip published to RabbitMQ:', trip._id);
    } else {
        console.log('No nearby drivers available');
    }
}
 
// RabbitMQ consumer to handle ride requests
async function startConsumer() {
    await consumeFromQueue('ride-requests', async (message) => {
        const trip = JSON.parse(message);
        await assignDriver(trip);
    });
}

module.exports = { assignDriver, startConsumer };