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
  vehicleType: { type: String },
  aadhar_front: { type: String }, // Stores the binary data for Aadhar front image
  aadhar_back: { type: String },  // Stores the binary data for Aadhar back image
  pan_front: { type: String },    // Stores the binary data for PAN front image
  pan_back: { type: String },     // Stores the binary datamul for PAN back image
  DL_front: { type: String },     // Stores the binary data for DL front image
  DL_back: { type: String },      // Stores the binary data for DL back image
  selfie: { type: String }    

  
});


driverSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Driver', driverSchema);