const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  driverId: { type: String, required: true },
  name: { type: String, required: true },
  unavailableRequests: { type: [String], default: [] }, // Stores IDs of users for whom the driver is unavailable
});

module.exports = mongoose.model('User', userSchema);
