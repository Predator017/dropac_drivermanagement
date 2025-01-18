const axios = require('axios');

async function verifyUPI(vpa) {
  try {
    const response = await axios.post('https://api.attestr.com/api/v1/public/finanx/vpa', { vpa });
    return response.data;
  } catch (error) {
    return { verified: false, message: error.message };
  }
}

async function verifyBankAccount(bankAccount) {
  try {
    const response = await axios.post('https://api.paymentgateway.com/verify/bank', { bankAccount });
    return response.data;
  } catch (error) {
    return { verified: false, message: error.message };
  }
}

module.exports = { verifyUPI, verifyBankAccount };