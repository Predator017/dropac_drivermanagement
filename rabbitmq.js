const amqp = require('amqplib');

let channel;

async function connectRabbitMQ(retries = 5) {
  try {
    const connection = await amqp.connect('amqp://dropac:dropac@192.168.1.3:5672');
    channel = await connection.createChannel();
    console.log('RabbitMQ connected');
  } catch (error) {
    if (retries === 0) {
      console.error('Failed to connect to RabbitMQ', error);
      throw error;
    }
    console.log(`Retrying RabbitMQ connection (${retries} retries left)...`);
    setTimeout(() => connectRabbitMQ(retries - 1), 5000);
  }
}

async function sendToQueue(queue, message) {
  if (!channel) {
    throw new Error('RabbitMQ channel is not initialized');
  }
  await channel.assertQueue(queue, { durable: true });
  channel.sendToQueue(queue, Buffer.from(message));
}

async function consumeFromQueue(queue, callback) {
  if (!channel) {
    throw new Error('RabbitMQ channel is not initialized');
  }
  await channel.assertQueue(queue, { durable: true });
  channel.consume(queue, (msg) => {
    if (msg !== null) {
      callback(msg.content.toString());
      channel.ack(msg);
    }
  });
}

module.exports = { connectRabbitMQ, sendToQueue, consumeFromQueue };