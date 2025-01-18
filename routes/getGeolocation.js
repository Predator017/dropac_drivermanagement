const express = require('express');
const router = express.Router();
const Driver = require('../models/driver');

// Update driver location
router.post('/update-location', async (req, res) => {
  const { driverId, lat, lng } = req.body;

  const driver = await Driver.findById(driverId);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  driver.location = { type: 'Point', coordinates: [lng, lat] };
  driver.online = true; // Ensure the driver is online
  await driver.save();

  res.status(200).json({ message: 'Location updated successfully' });
});

// Find nearby drivers
router.get('/nearby-drivers', async (req, res) => {
  const { lat, lng } = req.query;

  const nearbyDrivers = await Driver.find({
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: 5000 // 5 km radius
      }
    },
    online: true
  });

  const groupedByVehicleType = nearbyDrivers.reduce((acc, driver) => {
    const vehicleType = driver.vehicleType || 'unknown';
    if (!acc[vehicleType]) {
      acc[vehicleType] = [];
    }
    acc[vehicleType].push(driver);
    return acc;
  }, {});

  res.status(200).json(groupedByVehicleType);
});

module.exports = router;