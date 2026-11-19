import { describe, expect, it } from 'vitest';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { FakeDynamoDb } from './FakeDynamoDb';

/* The fake stands in for DynamoDB in tests, so its strictness is tested too. */

const TableName = 't';

describe('FakeDynamoDb', () => {
  it('enforces conditions like DynamoDB', async () => {
    const db = new FakeDynamoDb();
    const put = () =>
      db.send(
        new PutCommand({ TableName, Item: { pk: 'a', sk: 'b' }, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } }),
      );
    await put();
    await expect(put()).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  });

  it('rejects unused expression names and values', async () => {
    const db = new FakeDynamoDb();
    await expect(
      db.send(new PutCommand({ TableName, Item: { pk: 'a', sk: 'b' }, ExpressionAttributeNames: { '#unused': 'x' } })),
    ).rejects.toMatchObject({ name: 'ValidationException' });
  });

  it('refuses expressions it does not implement instead of guessing', async () => {
    const db = new FakeDynamoDb();
    await expect(
      db.send(
        new UpdateCommand({
          TableName,
          Key: { pk: 'a', sk: 'b' },
          UpdateExpression: 'SET #a = #a + :one',
          ExpressionAttributeNames: { '#a': 'a' },
          ExpressionAttributeValues: { ':one': 1 },
        }),
      ),
    ).rejects.toThrow(/unsupported/);
  });

  it('applies transactions all or nothing and rejects two operations on one item', async () => {
    const db = new FakeDynamoDb();
    await db.send(new PutCommand({ TableName, Item: { pk: 'p', sk: 'taken' } }));
    const cond = { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } };
    await expect(
      db.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName, Item: { pk: 'p', sk: 'new' }, ...cond } },
            { Put: { TableName, Item: { pk: 'p', sk: 'taken' }, ...cond } },
          ],
        }),
      ),
    ).rejects.toMatchObject({ name: 'TransactionCanceledException' });
    expect((await db.send(new GetCommand({ TableName, Key: { pk: 'p', sk: 'new' } })) as { Item?: unknown }).Item).toBeUndefined();

    await expect(
      db.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName, Item: { pk: 'p', sk: 'x' } } },
            { Delete: { TableName, Key: { pk: 'p', sk: 'x' } } },
          ],
        }),
      ),
    ).rejects.toMatchObject({ name: 'ValidationException' });
  });

  it('rejects items over 400 KB and paginates queries', async () => {
    const db = new FakeDynamoDb();
    await expect(db.send(new PutCommand({ TableName, Item: { pk: 'a', sk: 'big', blob: 'x'.repeat(410 * 1024) } }))).rejects.toMatchObject({
      name: 'ValidationException',
    });
    for (let i = 0; i < 10; i += 1) await db.send(new PutCommand({ TableName, Item: { pk: 'q', sk: `s${i}` } }));
    const page = (await db.send(
      new QueryCommand({ TableName, KeyConditionExpression: '#pk = :pk', ExpressionAttributeNames: { '#pk': 'pk' }, ExpressionAttributeValues: { ':pk': 'q' } }),
    )) as { Items: unknown[]; LastEvaluatedKey?: unknown };
    expect(page.Items).toHaveLength(7);
    expect(page.LastEvaluatedKey).toEqual({ pk: 'q', sk: 's6' });
  });
});
