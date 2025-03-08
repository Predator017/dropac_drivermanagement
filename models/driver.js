const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  mobile: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  email: { type: String, },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point' // Set the default type to 'Point'
    },
    coordinates: {
      type: [Number], // Array of numbers for [longitude, latitude]
      default: [0, 0] // Default to valid coordinates
    }
  },
  online: { type: Boolean, default: false },
  outstation: { type: Boolean, default: false },
  rating: { type: Number, default: 0 },
  orders: { type: Number, default: 0 },
  months: { type: Number, default: 0 },
  walletBalance: {
    total: { type: Number, default: 0 },
    part80: { type: Number, default: 0 },
    part20: { type: Number, default: 0 }
  },
  cleardues: [{
    paymentId: { type: String },
    amount: { type: Number },
    time: { type: String }
  }],
  
  willDrive: { type: Boolean },
  aadhar_front: { type: String }, 
  aadhar_back: { type: String },  
  pan_front: { type: String },     
  pan_back: { type: String },     
  DL_front: { type: String },     
  DL_back: { type: String },      
  selfie: { type: String },
  
  vehicleNumber: {type: String},
  RC_front : {type: String},
  RC_back : {type: String},
  cityOfOperations: { type: String },
  vehicleType: { type: String },
  bodyDetails: { type: String },
  bodyType: { type: String },

  rideInProgress: {type: Boolean, default: false},

  documentStatus: { type: String, default: 'new' }, //new, pending, success, failed
  vehicleStatus: {type: String, default: 'new'}, //new, pending, success, failed
  paymentdone: { type: Boolean, default: false }, //true


  
});


driverSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Driver', driverSchema);