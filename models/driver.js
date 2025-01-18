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
    time: { type: Date, default: Date.now }
  }],
  
  willDrive: { type: Boolean },
  aadhar_front: { type: String, required: true }, 
  aadhar_back: { type: String, required: true },  
  pan_front: { type: String, required: true },     
  pan_back: { type: String, required: true },     
  DL_front: { type: String, required: true },     
  DL_back: { type: String, required: true },      
  selfie: { type: String, required: true },
  
  vehicleNumber: {type: String, required: true},
  RC_front : {type: String},
  RC_back : {type: String},
  cityOfOperations: { type: String, required: true },
  vehicleType: { type: String, required: true },
  bodyDetails: { type: String, required: true },
  bodyType: { type: String, required: true },

  aadhar_front_correct : {type: Boolean},
  aadhar_back_correct : {type: Boolean},
  pan_front_correct : {type: Boolean},
  pan_back_correct : {type: Boolean},
  DL_front_correct : {type: Boolean},
  DL_back_correct : {type: Boolean},
  RC_front_correct : {type: Boolean},
  RC_back_correct : {type: Boolean},
  selfie_correct : {type: Boolean},
  
});


driverSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Driver', driverSchema);