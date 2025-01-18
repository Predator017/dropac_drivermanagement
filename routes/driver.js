const express = require('express');
const router = express.Router();
const Driver = require('../models/driver');
const jwt = require('jsonwebtoken');
const otpService = require('../otpservice');
const Document = require('../models/Document');
const Trip = require('../models/trip');
const { sendToQueue } = require('../rabbitmq');
//const { sendPushNotification } = require('../sendPushnotification');
const Vehicle = require('../models/vehicle');
const { status } = require('express/lib/response');
// Register Driver

const NodeCache = require("node-cache");

const app = express();
require("dotenv").config();
app.use(express.json());

let driverCache = new NodeCache({ stdTTL: 3600 });


router.post('/register', async (req, res) => {
  try {
    const { mobile, name, email } = req.body;

    /* const newDriver = new Driver({
      mobile,
      name,
      email,
      vehicleType, // Ensure vehicleType is set
    }); */
    //await newDriver.save();
    await otpService.sendOTP(mobile);


    const driverData = {
      mobile: mobile,
      name: name,
      email: email,
    };
  
    // Store user data in cache
    driverCache.set(mobile, driverData);

    res.status(201).json({ message: `OTP sent to ${mobile} successfully` });


  } catch (error) {
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});


// Login Driver
router.post('/login', async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) {
        return res.status(400).send('Mobile number is required');
    }

    const driver = await Driver.findOne({ mobile });
    if (driver==null) {
      res.status(404).send('Driver not found');
        
    } else {
      await otpService.sendOTP(mobile);
      res.status(200).send({ message: 'OTP sent', userId: driver._id });
    }
  } catch (error) {
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

// Send OTP
router.post('/send-otp', async (req, res) => {
  try {
    const { mobile } = req.body;
    const otp = await otpService.sendOTP(mobile);
    res.status(200).json({ message: 'OTP sent successfully', otp });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send OTP', details: error.message });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).send('Mobile number and OTP are required');
    }
  
    try {
      await otpService.verifyOTP(mobile, otp);
      const driver = await Driver.findOne({ mobile });
      if(driver==null){
        const DriverData = driverCache.get(mobile);
        const name = DriverData.name;
        const email = DriverData.email;
        const newDriver = new Driver({ mobile, name, email });
        await newDriver.save();
      }
      const driverr = await Driver.findOne({ mobile });

      //const documents = await Document.find({ userId: driverr._id });
      // const documentsUploaded = documents.length > 0;
      // const documentsVerified = documents.every(doc => doc.verified);
      // const paymentDone = documents.every(doc => doc.paymentdone);

      const token = jwt.sign({ userId: driverr._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const refreshToken = jwt.sign({ userId: driverr._id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
      const epochTime = Math.floor(Date.now() / 1000); // Get the current epoch time
      res.status(200).json({ message: 'Login successful and token expire time is 1h', token, refreshToken, epochTime, userId: driverr._id  });
    } catch (error) {
      res.status(400).send(error.message);
    }
  }
);


router.post ('/refresh-token', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(401).json({ message: 'Refresh token is required' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const accessToken = jwt.sign({ userId: decoded.userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const epochTime = Math.floor(Date.now() / 1000); // Get the current epoch time
    res.status(200).json({ accessToken, epochTime, message: 'expiry time is 1h' });
  } catch (error) {
    res.status(401).json({ message: 'Invalid refresh token', error });
  }
} );


// api to get driver profile
router.get('/profile/:driverId', async (req, res) => {
  try {
    const id = req.params.driverId;

    // Fetch the driver details
    const driver = await Driver.findById(id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    
    // Send response with driver and document statuses
    res.status(200).json({
      driver
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve driver details',
      details: error.message
    });
  }
});




// update driver details with vehicle type and will drive
router.post('/update-driver', async (req, res) => {
  try {
    
  

    const { driverId, willDrive, vehicleNumber,cityOfOperations
      ,vehicleType,bodyDetails,bodyType} = req.body;
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    driver.willDrive = willDrive;
    driver.vehicleNumber = vehicleNumber;
    driver.cityOfOperations = cityOfOperations;
    driver.vehicleType = vehicleType;
    driver.bodyDetails = bodyDetails;
    driver.bodyType = bodyType;
    
    await driver.save();

    res.status(200).json({ message: 'Driver details updated', driver });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update driver details', details: error.message });
  }
});













// Not completed

router.post('/set-status', async (req, res) => {
  const { driverId, online, outstation } = req.body;

  if (typeof online !== 'boolean') {
    return res.status(400).json({ message: 'Online status must be a boolean' });
  }

  if (outstation !== undefined && typeof outstation !== 'boolean') {
    return res.status(400).json({ message: 'Outstation status must be a boolean' });
  }

  try {
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    driver.online = online;

    // Only allow changing outstation status if the driver is online
    if (driver.online && outstation !== undefined) {
      driver.outstation = outstation;
    } else if (!driver.online && outstation !== undefined) {
      return res.status(400).json({ message: 'Cannot change outstation status when driver is offline' });
    }

    await driver.save();

    res.status(200).json({ message: `Driver status updated`, online: driver.online, outstation: driver.outstation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status', details: error.message });
  }
});

// Driver accepts/rejects trip
/* router.post('/respond-trip', async (req, res) => {
  const { driverId, tripId, response } = req.body;

  try {
      const trip = await Trip.findById(tripId);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });

      if (response === 'accept') {
          trip.status = 'accepted';
          await trip.save();

          // Send push notification to the customer
          await sendPushNotification(trip.customerId, 'Trip accepted', 'Your trip has been accepted by the driver.');

          // Publish trip response to RabbitMQ
          await sendToQueue('trip-responses', JSON.stringify({ tripId, driverId, response: 'accepted' }));

          res.status(200).json({ message: 'Trip accepted', trip });
      } else if (response === 'reject') {
          trip.status = 'rejected';
          trip.cancellationReason = req.body.reason;
          await trip.save();

          // Send push notification to the customer
          await sendPushNotification(trip.customerId, 'Trip rejected', 'Your trip has been rejected by the driver.');

          // Publish trip response to RabbitMQ
          await sendToQueue('trip-responses', JSON.stringify({ tripId, driverId, response: 'rejected' }));

          res.status(200).json({ message: 'Trip rejected', trip });
      } else {
          res.status(400).json({ message: 'Invalid response' });
      }
  } catch (error) {
      res.status(500).json({ error: 'Failed to respond to trip', details: error.message });
  }
});
 */
// a api to only give status of the trip
router.get('/trip-status/:tripId', async (req, res) => {
  try {
      const trip = await Trip.findById(req.params.tripId);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });

      res.status(200).json({ status: trip.status });
  } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve trip status', details: error.message });
  }
});

//  second api will be once driver is accepted send driver details like name, vehcile type and lat , long and pin and send at pickup want driver lat , long ( need to give location of driver)

router.get('/trip-details/:tripId', async (req, res) => {
  try {
      const trip = await Trip.findById(req.params.tripId);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });

      const driver = await Driver.findById(trip.driverId);
      if (!driver) return res.status(404).json({ error: 'Driver not found' });


      // here vehicle modle is define in that there is userid which is id of driver model now we need to get the vehicle number from the vehicle model
      const vehicle = await Vehicle.findOne({ userId: driver._id });


      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

      res.status(200).json({
        driverName: driver.name,
        vehicleType: driver.vehicleType,
        driverLocation: driver.location,
        driverPin: driver.pin,
        pickupLocation: trip.pickupLocation,
        dropoffLocations: trip.dropoffLocations,
        tripOtp: trip.tripOtp,
        status: trip.status,
        driverMobile: driver.mobile,
        vehicleNumber: vehicle.vehicleNumber
      });
  } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve trip details', details: error.message });
  }
}
);

// api to cleaer a due amount from the driver wallet balance part 20 of the driver we will ccleardues feild in database from the body we will get fro cleardues feild only
router.post('/clear-dues/:driverId', async (req, res) => {
  const { paymentId, amount } = req.body;

  if (!paymentId || !amount) {
    return res.status(400).json({ message: 'Payment ID and amount are required' });
  }

  try {
    const driver = await Driver.findById(req.params.driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    // Clear or make the part 20 of the driver wallet balance to 0
    driver.walletBalance.part20 = 0;

    // Add the new transaction to the cleardues array
    driver.cleardues.push({
      paymentId,
      amount
    });

    await driver.save();
    res.status(200).json({ message: 'Dues cleared successfully', driver });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear dues', details: error.message });
  }
});

// api to get cleaedues object from the driver model
router.get('/cleared-dues/:driverId', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    res.status(200).json(driver.cleardues);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve cleared dues', details: error.message });
  }
});

// api to give trip details to the driver
router.get('/trip-details-driver/:tripId', async (req, res) => {
  try {
      const trip = await Trip.findById(req.params.tripId);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });

      const driver = await Driver.findById(trip.driverId);
      if (!driver) return res.status(404).json({ error: 'Driver not found' });


      // here vehicle modle is define in that there is userid which is id of driver model now we need to get the vehicle number from the vehicle model
      const vehicle = await Vehicle.findOne({ userId: driver._id });


      if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

      res.status(200).json({
        status: trip.status,
        driverLocation: driver.location,
        dropplocation: trip.dropoffLocations,
      });
  } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve trip details', details: error.message });
  }
}
);
module.exports = router;