require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
//const { connectRabbitMQ } = require('./rabbitmq');
const { startConsumer } = require('./tripService');
//const { sendPushNotification } = require('./sendPushnotification');
const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// Connect RabbitMQ and start consumer
//connectRabbitMQ().then(startConsumer).catch(console.error);

// Middleware to parse JSON
app.use(express.json());

const driverId = 'eoszOqfO0kvlnoptHluKI3:APA91bEdrSzeFt64LSRlj-J-jO9eGNEz0Nthz33FsBABWnx1tBrTeAQNe7vMYns6NXnDbs6ldeL6xDqMKlaw2q86Ohg3dY4-6g6DXEIR5ex-wRb_Iry8uAs';
const title = 'New trip assignment';
const body = 'You have a new trip request. Please accept or reject.';
const trip = {
    customerId: "faesdfaw452",
    pickupCustomerDetails: {
        name: "John f34f",
        mobile: "1234567890"
    },
    pickupLocation: {
        type: "Point",
        coordinates: [-74.0060, 40.7128], // Longitude first, then latitude
        address: "123 Main St, New York, NY 10001"
    },
    dropoffLocations: [
        {
            dropoffCustomerDetails: {
                name: "Jane Doe",
                mobile: "0987654321",
                destinationReached: 0
            },
            dropoffLocation: {
                type: "Point",
                coordinates: [-118.2437, 34.0522], // Longitude first, then latitude
                address: "456 Elm St, Los Angeles, CA 90001"
            }
        },
        {
            dropoffCustomerDetails: {
                name: "Alice Smith",
                mobile: "1122334455"
            },
            dropoffLocation: {
                type: "Point",
                coordinates: [-122.4194, 37.7749], // Longitude first, then latitude
                address: "789 Pine St, San Francisco, CA 94101"
            }
        }
    ],
    distance: 100,
    duration: 120,
    fare: 50,
    vehicleType: "sedan",
    driverId: "driver123",
    status: "pending"
};

// const deviceToken ='e8jBUbeNRyaOK_xOi6_kRK:APA91bGki3L0cxHIh3a20TNKh-mrkYJHtLO9aU55owF5kFv1U32SOSc8jQbB-xvIn7_2f3UrVZfokPO19XRN2KJTuv_vCb9RxFMHf-Xy2sgDwE6tuE61Pgo';
 
//sendPushNotification(driverId, title, body, trip);

// Routes
const documentRoutes = require('./routes/document');
const vehicleRoutes = require('./routes/vehicle');
const driverRoutes = require('./routes/driver');
const tripRoutes = require('./routes/trip');
const walletRoutes = require ('./routes/wallet');
const geolocationRoutes = require('./routes/getGeolocation');

// Register routes
app.use('/api/documents', documentRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/geolocation', geolocationRoutes);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});