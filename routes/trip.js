const express = require('express');
const router = express.Router();
const otpService = require('../otpservice');
const Trip = require('../models/trip');
const Driver = require('../models/driver'); // Add this line to import the Driver model
const { producer } = require('../rabbitmq');
const { sendToQueue } = require('../rabbitmq');
const { where } = require('../models/vehicle');

// Create a new trip

router.post('/create', async (req, res) => {
    try {
        const { customerId, pickupCustomerDetails, pickupLocation, dropoffLocations, distance, duration, fare, vehicleType, driverId } = req.body;
        const newTrip = new Trip({
            customerId,
            pickupCustomerDetails,
            pickupLocation,
            dropoffLocations,
            distance,
            duration,
            fare,
            vehicleType,
            tripOtp: otpService.generateOTP(),
            status: 'pending',
        });
        await newTrip.save();
        // Publish trip creation to RabbitMQ
        await sendToQueue('ride-requests', JSON.stringify(newTrip));

        res.status(201).json({ message: 'Trip created successfully', tripId: newTrip._id });
    } catch (error) {
        res.status(500).json({ error: 'Trip creation failed', details: error.message });
    }
});

// Get all trip details for particular driver for today

router.get('/driver/:driverId', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Fetch trips
        const trips = await Trip.find({ 
            driverId: req.params.driverId, 
            createdAt: { $gte: today },
            status: 'completed'
        });

        // Fetch driver document
        const driver = await Driver.findById(req.params.driverId);
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
        }

        // Access walletBalance from driver document
        const walletBalance = driver.walletBalance;

        // Combine trips and walletBalance into a single response object
        res.status(200).json({ trips, walletBalance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve trips', details: error.message });
    }
});

// api to mark destination reached by the driver to the customer

router.put('/destination-reached/:tripId', async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        const dropoffLocationIndex = req.body.dropoffLocationIndex;
        trip.dropoffLocations[dropoffLocationIndex].dropoffCustomerDetails.destinationReached = true;
        await trip.save();

        res.status(200).json({ message: 'Destination reached successfully', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark destination reached', details: error.message });
    }
}
);

// transaction api where i will send fare20 percent from trip model and tripid and createdAt from trip model and walletbalance from driver model so i will only take driver id and from that i will fetcha all of those thing and it will be a get request

router.get('/transaction/:driverId', async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.driverId);
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
        }

        // Fetch trips
        const trips = await Trip.find({ 
            driverId: req.params.driverId, 
            status: 'completed'
        });

        const data = trips.map(trip => {
            return {
                id: trip.id,
                createdAt: trip.createdAt,
                fare: trip.fare * 0.2
            };
        });

        // Access walletBalance from driver document
        const walletBalance = driver.walletBalance;

        // Combine trips and walletBalance into a single response object
        res.status(200).json({ data, walletBalance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve transactions', details: error.message });
    }
}
);

// Get all trip details for particular driver till date babsed on date params filter this out

router.get('/driver/:driverId/:date', async (req, res) => {
    try {
        const date = new Date(req.params.date);
        const nextDate = new Date(date);
        nextDate.setDate(date.getDate() + 1);
        const trips = await Trip.find({ 
            driverId: req.params.driverId, 
            createdAt: { $gte: date, $lt: nextDate },
            status: 'completed'
        });
        const driver = await Driver.findById(req.params.driverId);
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
        }

        // Access walletBalance from driver document
        const walletBalance = driver.walletBalance;

        // Combine trips and walletBalance into a single response object
        res.status(200).json({ trips, walletBalance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve trips', details: error.message });
    }
});

// if the driver was assigned a trip and he has completed the trip, then update the status of the trip with otp verification using the otp service

router.put('/complete/:tripId', async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        // Find the driver
        const driver = await Driver.findById(trip.driverId);
        if (!driver) return res.status(404).json({ error: 'Driver not found' });

        // Update trip status to 'completed'
        trip.status = 'completed';
        await trip.save();

        // Update driver wallet balance
        const fare = trip.fare;
        const part80 = fare * 0.8;
        const part20 = fare * 0.2;

        // Ensure walletBalance is an object with the correct structure
        if (typeof driver.walletBalance !== 'object') {
            driver.walletBalance = {
                total: 0,
                part80: 0,
                part20: 0
            };
        }

        driver.walletBalance.total += fare;
        driver.walletBalance.part80 += part80;
        driver.walletBalance.part20 += part20;
        await driver.save();

        res.status(200).json({ message: 'Trip completed successfully', trip, walletBalance: driver.walletBalance });
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete trip', details: error.message });
    }

});

// start a trip by the driver by sending the otp to the driver

router.post('/start/:tripId', async (req, res) => {
    try {
        const { tripId } = req.params;
        const { mobile } = req.body;

        // Find the driver by mobile number
        const driver = await Driver.findOne({ mobile });
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
        }

        // Send OTP to the driver's mobile
        await otpService.sendOTP(mobile);
        res.status(200).json({ message: 'OTP sent to driver\'s mobile', tripId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send OTP', details: error.message });
    }
});

// Verify OTP and start the trip

router.post('/start/:tripId/verify', async (req, res) => {
    try {
        const { tripId } = req.params;
        const { otp } = req.body;

        // Verify OTP
        const trip = await Trip.findById(tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        if (trip.tripOtp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }
        trip.status = 'started';
        await trip.save();

        res.status(200).json({ message: 'OTP is verfied and Trip started successfully', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start trip', details: error.message });
    }
}
);

// api to show the driver is busy with the trip based on the trip status

router.get('/driver/:driverId/busy', async (req, res) => {
    try {
        const trip = await Trip.findOne({ driverId: req.params.driverId, status: 'in progress' });
        if (!trip) return res.status(404).json({ message: 'Driver is not busy with any trip' });
        res.status(200).json({ message: 'Driver is busy with a trip', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve trip details', details: error.message });
    }
}
); 



// api to mark the trip as completed by the driver and drive and collect the fare from the customer

router.put('/complete/:tripId', async (req, res) => { 
    try {
        const trip = await Trip.findById(req.params.tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        trip.status = 'completed';
        await trip.save();

        res.status(200).json({ message: 'Trip completed successfully', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete trip', details: error.message });
    }
}
);

// api to give the rating by the driver to the customer based on the trip

router.put('/rate/:tripId', async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        trip.rating = req.body.rating;
        await trip.save();

        res.status(200).json({ message: 'Trip rated successfully', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to rate trip', details: error.message });
    }
}
);

// api to cancel the trip by the driver along with the reason to take from the driver

router.put('/cancel/:tripId', async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        trip.status = 'cancelled';
        trip.cancellationReason = req.body.reason;
        await trip.save();

        // Reassign the trip to another driver
        await sendToQueue('ride-requests', JSON.stringify(trip));

        res.status(200).json({ message: 'Trip cancelled successfully', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel trip', details: error.message });
    }
});


// api to get trip details for the particular customer it should be based on the customer id and it is a paginated api with dynamic scrolling pagination

router.get('/customer/:customerId', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const trips = await Trip.find({ customerId: req.params.customerId })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await Trip.countDocuments({ customerId: req.params.customerId });
        res.status(200).json({
            trips,
            totalPages: Math.ceil(count / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve trips', details: error.message });
    }
}
);

// api to set the payment status of the trip by the driver

router.put('/payment-status/:tripId', async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.tripId);
        if (!trip) return res.status(404).json({ error: 'Trip not found' });

        trip.paymentStatus = req.body.status;
        await trip.save();

        res.status(200).json({ message: 'Payment status updated successfully', trip });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update payment status', details: error.message });
    }
}
);

// router.get('/trip-status/:tripId', async (req, res) => {
//     try {
//         const trip = await Trip.findById(req.params.tripId);
//         if (!trip) return res.status(404).json({ error: 'Trip not found' });

//         res.status(200).json({ status: trip.status, location: trip.pickupLocation });
//     } catch (error) {
//         res.status(500).json({ error: 'Failed to retrieve trip status', details: error.message });
//     }
// });


// api to cancel the trip by the customer along with the reason to take from the customer

// router.put('/cancel/:tripId', async (req, res) => {
//     try {
//         const trip = await Trip.findById(req.params.tripId);
//         if (!trip) return res.status(404).json({ error: 'Trip not found' });

//         trip.status = 'cancelled';
//         trip.cancelReason = req.body.reason;
//         await trip.save();

//         res.status(200).json({ message: 'Trip cancelled successfully', trip });
//     } catch (error) {
//         res.status(500).json({ error: 'Failed to cancel trip', details: error.message });
//     }
// }
// );

module.exports = router;
