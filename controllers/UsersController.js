import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';
import userQueue from '../worker';

class UsersController {
  static async postNew(req, res) {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    const db = dbClient.client.db(dbClient.dbName);
    const existingUser = await db.collection('users').findOne({ email });

    if (existingUser) {
      return res.status(400).json({ error: 'Already exist' });
    }

    const hashedPassword = crypto.createHash('sha1').update(password).digest('hex');

    const result = await db.collection('users').insertOne({
      email,
      password: hashedPassword,
    });

    userQueue.add({ userId: result.insertedId });

    return res.status(201).json({
      id: result.insertedId,
      email,
    });
  }

  static async getMe(req, res) {
    const token = req.header('X-Token');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = dbClient.client.db(dbClient.dbName);
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.status(200).json({ id: user._id, email: user.email });
  }
}

export default UsersController;
