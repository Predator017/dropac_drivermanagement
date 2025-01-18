const express = require('express');
const router = express.Router();
const Wallet = require('../models/wallet');
const Driver = require('../models/driver');
const { verifyUPI, verifyBankAccount } = require('../axios');

// Get all transactions for a user
router.get('/:userId/transactions', async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.params.userId }).populate('transactions');
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.status(200).json(wallet.transactions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve transactions', details: error.message });
  }
});

// Withdraw funds
router.post('/:userId/withdraw', async (req, res) => {
  const { userId } = req.params;
  const { amount, method, upiId, bankAccount } = req.body;

  if (!amount || !method) {
    return res.status(400).json({ error: 'Amount and method are required' });
  }

  try {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    if (wallet.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    let verificationResult;
    if (method === 'upi') {
      verificationResult = await verifyUPI(upiId);
    } else if (method === 'bank') {
      verificationResult = await verifyBankAccount(bankAccount);
    } else {
      return res.status(400).json({ error: 'Invalid withdrawal method' });
    }

    if (!verificationResult.verified) {
      return res.status(400).json({ error: 'Verification failed', details: verificationResult.message });
    }

    wallet.balance -= amount;
    wallet.transactions.push({ userId, amount, type: 'debit', description: 'Withdrawal' });
    await wallet.save();

    res.status(200).json({ message: 'Withdrawal successful', balance: wallet.balance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process withdrawal', details: error.message });
  }
});

module.exports = router;