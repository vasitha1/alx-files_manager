import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';
import fileQueue from '../worker';

class FilesController {
  static async getUser(token) {
    if (!token) return null;

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return null;

    const db = dbClient.client.db(dbClient.dbName);
    return db.collection('users').findOne({ _id: ObjectId(userId) });
  }

  static async postUpload(req, res) {
    const token = req.header('X-Token');
    const user = await FilesController.getUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (!data && type !== 'folder') {
      return res.status(400).json({ error: 'Missing data' });
    }

    const db = dbClient.client.db(dbClient.dbName);

    if (parentId !== 0) {
      const parent = await db.collection('files').findOne({ _id: ObjectId(parentId) });
      if (!parent) {
        return res.status(400).json({ error: 'Parent not found' });
      }
      if (parent.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    const fileDoc = {
      userId: ObjectId(user._id),
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? 0 : ObjectId(parentId),
    };

    if (type === 'folder') {
      const result = await db.collection('files').insertOne(fileDoc);
      return res.status(201).json({
        id: result.insertedId,
        userId: user._id,
        name,
        type,
        isPublic,
        parentId,
      });
    }

    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const localPath = path.join(folderPath, uuidv4());
    const fileData = Buffer.from(data, 'base64');

    fs.writeFileSync(localPath, fileData);

    fileDoc.localPath = localPath;
    const result = await db.collection('files').insertOne(fileDoc);

    if (type === 'image') {
      fileQueue.add({
        userId: user._id,
        fileId: result.insertedId,
      });
    }

    return res.status(201).json({
      id: result.insertedId,
      userId: user._id,
      name,
      type,
      isPublic,
      parentId,
    });
  }

  static async getShow(req, res) {
    const token = req.header('X-Token');
    const user = await FilesController.getUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const db = dbClient.client.db(dbClient.dbName);
    const file = await db.collection('files').findOne({
      _id: ObjectId(id),
      userId: ObjectId(user._id),
    });

    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    });
  }

  static async getIndex(req, res) {
    const token = req.header('X-Token');
    const user = await FilesController.getUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { parentId = 0, page = 0 } = req.query;
    const pageNum = parseInt(page, 10);
    const limit = 20;
    const skip = pageNum * limit;

    const db = dbClient.client.db(dbClient.dbName);
    const query = { userId: ObjectId(user._id) };

    if (parentId !== 0) {
      query.parentId = ObjectId(parentId);
    } else {
      query.parentId = 0;
    }

    const files = await db.collection('files')
      .find(query)
      .skip(skip)
      .limit(limit)
      .toArray();

    return res.status(200).json((files).map((file) => ({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    })));
  }

  static async putPublish(req, res) {
    const token = req.header('X-Token');
    const user = await FilesController.getUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const db = dbClient.client.db(dbClient.dbName);

    const file = await db.collection('files').findOneAndUpdate(
      { _id: ObjectId(id), userId: ObjectId(user._id) },
      { $set: { isPublic: true } },
      { returnOriginal: false },
    );

    if (!file.value) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json({
      id: file.value._id,
      userId: file.value.userId,
      name: file.value.name,
      type: file.value.type,
      isPublic: file.value.isPublic,
      parentId: file.value.parentId,
    });
  }

  static async putUnpublish(req, res) {
    const token = req.header('X-Token');
    const user = await FilesController.getUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const db = dbClient.client.db(dbClient.dbName);

    const file = await db.collection('files').findOneAndUpdate(
      { _id: ObjectId(id), userId: ObjectId(user._id) },
      { $set: { isPublic: false } },
      { returnOriginal: false },
    );

    if (!file.value) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json({
      id: file.value._id,
      userId: file.value.userId,
      name: file.value.name,
      type: file.value.type,
      isPublic: file.value.isPublic,
      parentId: file.value.parentId,
    });
  }

  static async getFile(req, res) {
    const { id } = req.params;
    const { size } = req.query;
    const token = req.header('X-Token');

    const db = dbClient.client.db(dbClient.dbName);
    const file = await db.collection('files').findOne({ _id: ObjectId(id) });

    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!file.isPublic) {
      const user = await FilesController.getUser(token);
      if (!user || file.userId.toString() !== user._id.toString()) {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    if (file.type === 'folder') {
      return res.status(400).json({ error: "A folder doesn't have content" });
    }

    let filePath = file.localPath;
    if (size && ['100', '250', '500'].includes(size)) {
      filePath = `${file.localPath}_${size}`;
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const mimeType = mime.lookup(file.name) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);

    const fileData = fs.readFileSync(filePath);
    return res.send(fileData);
  }
}

export default FilesController;
