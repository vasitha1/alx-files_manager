import { expect } from 'chai';
import redisClient from '../utils/redis';

describe('redisClient', () => {
  it('should be alive', () => {
    expect(redisClient.isAlive()).to.be.true;
  });

  it('should set and get values', async () => {
    await redisClient.set('test_key', 'test_value', 10);
    const value = await redisClient.get('test_key');
    expect(value).to.equal('test_value');
  });

  it('should delete values', async () => {
    await redisClient.set('test_key2', 'test_value2', 10);
    await redisClient.del('test_key2');
    const value = await redisClient.get('test_key2');
    expect(value).to.be.null;
  });
});