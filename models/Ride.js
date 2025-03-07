const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  userId: { type: String },
  otp: { type: String },
  driverId: { type: String },
  driverName: {type: String},
  vehicleType: { type: String },
  vehicleNumber: { type: String },
  pickupDetails: {
    pickupName: { type: String, required: true },
    pickupPhone: { type: String, required: true },
    pickupAddress: { type: String, required: true },
    pickupLat: { type: Number, required: true },
    pickupLon: { type: Number, required: true },
  },
  dropDetails1: {
    dropName: { type: String, required: true },
    dropPhone: { type: String, required: true },
    dropAddress: { type: String, required: true },
    dropLat: { type: Number, required: true },
    dropLon: { type: Number, required: true },

  },

  dropDetails2: {
    dropName: { type: String },
    dropPhone: { type: String },
    dropAddress: { type: String },
    dropLat: { type: Number },
    dropLon: { type: Number },

  },

  dropDetails3: {
    dropName: { type: String },
    dropPhone: { type: String },
    dropAddress: { type: String },
    dropLat: { type: Number },
    dropLon: { type: Number },

  },
  
  outStation: {type: Boolean},
  cancelledBy : {type: String},
  reasonForCancellation: {type: String},
  vehicleType: {type:String},
  ratingByUser: {type:String},
  ratingByDriver: {type:String},
  currentDropNumber: {type : String},  
  fare: { type: Number, required: true }, // Fare for the ride
  driverShare : {type:Number},
  dropacShare : {type:Number},
  distance: { type: Number, required: true }, // Distance in kilometers
  duration: { type: Number, required: true }, // Duration in minutes
  status: { type: String },
  paymentStatus: {type: Boolean},
  createdAt: { type: String },
  confirmedAt: { type: String },
  completedAt: {type: String},
  cancelledAt: { type: String },
  timeoutAt: { type: String },
});


module.exports = mongoose.model('Ride', rideSchema);
