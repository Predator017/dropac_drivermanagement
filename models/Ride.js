const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  userLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // Longitude, Latitude
      default: [0, 0],
    }
  },
  otp: {type:String},
  driverId: {type:String},
  status: { type: String },
  createdAt: { type: String },
  confirmedAt:{type:String},
  cancelledAt: {type:String},
  timeoutAt: { type: String },
});

rideSchema.index({ userLocation: '2dsphere' });

module.exports = mongoose.model('Ride', rideSchema);
