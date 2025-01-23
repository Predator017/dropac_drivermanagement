const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  userId: { type: String },
  otp: { type: String },
  driverId: { type: String },
  pickupDetails: {
    pickupName: { type: String, required: true },
    pickupPhone: { type: String, required: true },
    pickupAddress: { type: String, required: true },
    pickupLat: { type: Number, required: true },
    pickupLon: { type: Number, required: true },
  },
  dropDetails: {
    dropName: { type: String, required: true },
    dropPhone: { type: String, required: true },
    dropAddress: { type: String, required: true },
    dropLat: { type: Number, required: true },
    dropLon: { type: Number, required: true },
  },
  fare: { type: Number, required: true }, // Fare for the ride
  distance: { type: Number, required: true }, // Distance in kilometers
  duration: { type: Number, required: true }, // Duration in minutes
  status: { type: String },
  createdAt: { type: String },
  confirmedAt: { type: String },
  cancelledAt: { type: String },
  timeoutAt: { type: String },
});

rideSchema.index({ driverLocation: '2dsphere' });

module.exports = mongoose.model('Ride', rideSchema);
