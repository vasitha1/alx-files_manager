import Bull from 'bull';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs';
import { ObjectId } from 'mongodb';
import dbClient from './utils/db.js';

const fileQueue = new Bull('fileQueue');

fileQueue.process(async (job) => {
    const { fileId, userId } = job.data;

    if (!fileId) {
        throw new Error('Missing fileId');
    }

    if (!userId) {
        throw new Error('Missing userId');
    }

    const db = dbClient.client.db(dbClient.dbName);
    const file = await db.collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId)
    });

    if (!file) {
        throw new Error('File not found');
    }

    const sizes = [500, 250, 100];

    for (const size of sizes) {
        try {
            const thumbnail = await imageThumbnail(file.localPath, { width: size });
            const thumbnailPath = `${file.localPath}_${size}`;
            fs.writeFileSync(thumbnailPath, thumbnail);
        } catch (error) {
            console.error(`Error generating thumbnail ${size}:`, error);
        }
    }


});

const userQueue = new Bull('userQueue');

userQueue.process(async (job) => {
    const { userId } = job.data;

    if (!userId) {
        throw new Error('Missing userId');
    }

    const db = dbClient.client.db(dbClient.dbName);
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    if (!user) {
        throw new Error('User not found');
    }

    console.log(`Welcome ${user.email}!`);
});

export default { fileQueue, userQueue };