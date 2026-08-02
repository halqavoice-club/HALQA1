/**
 * Elasticsearch Search Engine
 * 
 * Provides full-text search capabilities using Elasticsearch.
 * Supports:
 * - Index management
 * - Document indexing
 * - Full-text search
 * - Aggregations
 * - Search suggestions
 * - Index synchronization with database
 * 
 * Usage:
 *   const es = require('./utils/elasticsearch');
 *   
 *   // Initialize
 *   await es.initialize();
 *   
 *   // Index document
 *   await es.indexDocument('users', '123', { name: 'John', email: 'john@example.com' });
 *   
 *   // Search
 *   const results = await es.search('users', { query: 'John' });
 * 
 * Environment Variables:
 *   ELASTICSEARCH_URL: Elasticsearch URL (default: http://localhost:9200)
 *   ELASTICSEARCH_USERNAME: Elasticsearch username
 *   ELASTICSEARCH_PASSWORD: Elasticsearch password
 *   ELASTICSEARCH_ENABLED: true/false (default: true)
 */

const { Client } = require('@elastic/elasticsearch');
const logger = require('./logger');
const { alertCritical } = require('./alerting');
const prom = require('./prometheus');

let client = null;
let enabled = process.env.ELASTICSEARCH_ENABLED !== 'false';
const url = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const username = process.env.ELASTICSEARCH_USERNAME;
const password = process.env.ELASTICSEARCH_PASSWORD;

/**
 * Initialize Elasticsearch client
 */
async function initialize() {
  try {
    const clientConfig = {
      node: url
    };

    if (username && password) {
      clientConfig.auth = {
        username,
        password
      };
    }

    client = new Client(clientConfig);

    // Test connection
    const health = await client.cluster.health();
    logger.info(`[elasticsearch] Connected to Elasticsearch, cluster status: ${health.status}`);
  } catch (error) {
    logger.error('[elasticsearch] Failed to initialize:', error);
    enabled = false;
  }
}

/**
 * Create index
 */
async function createIndex(indexName, mapping = {}) {
  if (!enabled || !client) {
    logger.warn('[elasticsearch] Elasticsearch disabled');
    return { success: false };
  }

  try {
    const exists = await client.indices.exists({ index: indexName });

    if (!exists) {
      await client.indices.create({
        index: indexName,
        body: {
          mappings: mapping
        }
      });

      logger.info(`[elasticsearch] Created index: ${indexName}`);
    }

    return { success: true, exists: !exists };
  } catch (error) {
    logger.error(`[elasticsearch] Failed to create index ${indexName}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete index
 */
async function deleteIndex(indexName) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    await client.indices.delete({ index: indexName });
    logger.info(`[elasticsearch] Deleted index: ${indexName}`);
    return { success: true };
  } catch (error) {
    logger.error(`[elasticsearch] Failed to delete index ${indexName}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Index document
 */
async function indexDocument(indexName, documentId, document, options = {}) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    const result = await client.index({
      index: indexName,
      id: documentId,
      body: document,
      refresh: options.refresh || false
    });

    logger.debug(`[elasticsearch] Indexed document ${documentId} in ${indexName}`);
    return { success: true, result };
  } catch (error) {
    logger.error(`[elasticsearch] Failed to index document ${documentId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk index documents
 */
async function bulkIndex(indexName, documents) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    const body = documents.flatMap(doc => [
      { index: { _index: indexName, _id: doc.id } },
      doc
    ]);

    const result = await client.bulk({ body, refresh: true });

    if (result.errors) {
      const errors = result.items.filter(item => item.index.error);
      logger.error(`[elasticsearch] Bulk indexing had ${errors.length} errors`);
    }

    logger.info(`[elasticsearch] Bulk indexed ${documents.length} documents in ${indexName}`);
    return { success: true, result };
  } catch (error) {
    logger.error('[elasticsearch] Failed to bulk index:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Search documents
 */
async function search(indexName, query, options = {}) {
  if (!enabled || !client) {
    return { hits: { total: { value: 0 }, hits: [] } };
  }

  try {
    const {
      size = 10,
      from = 0,
      sort = [],
      aggregations = null,
      highlight = null
    } = options;

    const searchBody = {
      query,
      size,
      from,
      sort
    };

    if (aggregations) {
      searchBody.aggs = aggregations;
    }

    if (highlight) {
      searchBody.highlight = highlight;
    }

    const result = await client.search({
      index: indexName,
      body: searchBody
    });

    return result.body;
  } catch (error) {
    logger.error(`[elasticsearch] Search failed in ${indexName}:`, error);
    return { hits: { total: { value: 0 }, hits: [] }, error: error.message };
  }
}

/**
 * Simple text search
 */
async function simpleSearch(indexName, searchTerm, options = {}) {
  const {
    fields = ['name', 'description', 'title'],
    size = 10,
    from = 0
  } = options;

  const query = {
    multi_match: {
      query: searchTerm,
      fields,
      fuzziness: 'AUTO'
    }
  };

  return await search(indexName, query, { size, from });
}

/**
 * Get document by ID
 */
async function getDocument(indexName, documentId) {
  if (!enabled || !client) {
    return null;
  }

  try {
    const result = await client.get({
      index: indexName,
      id: documentId
    });

    return result.body._source;
  } catch (error) {
    if (error.meta.statusCode === 404) {
      return null;
    }
    logger.error(`[elasticsearch] Failed to get document ${documentId}:`, error);
    return null;
  }
}

/**
 * Update document
 */
async function updateDocument(indexName, documentId, updates) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    const result = await client.update({
      index: indexName,
      id: documentId,
      body: { doc: updates },
      refresh: true
    });

    logger.debug(`[elasticsearch] Updated document ${documentId} in ${indexName}`);
    return { success: true, result };
  } catch (error) {
    logger.error(`[elasticsearch] Failed to update document ${documentId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete document
 */
async function deleteDocument(indexName, documentId) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    await client.delete({
      index: indexName,
      id: documentId,
      refresh: true
    });

    logger.debug(`[elasticsearch] Deleted document ${documentId} from ${indexName}`);
    return { success: true };
  } catch (error) {
    logger.error(`[elasticsearch] Failed to delete document ${documentId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Get search suggestions
 */
async function getSuggestions(indexName, field, prefix, options = {}) {
  const { size = 5 } = options;

  const query = {
    prefix: {
      [field]: {
        value: prefix
      }
    }
  };

  const result = await search(indexName, query, {
    size,
    _source: [field]
  });

  return result.hits.hits.map(hit => hit._source[field]);
}

/**
 * Get aggregations
 */
async function getAggregations(indexName, aggregationQuery) {
  if (!enabled || !client) {
    return null;
  }

  try {
    const result = await client.search({
      index: indexName,
      body: {
        size: 0,
        aggs: aggregationQuery
      }
    });

    return result.body.aggregations;
  } catch (error) {
    logger.error(`[elasticsearch] Aggregation failed in ${indexName}:`, error);
    return null;
  }
}

/**
 * Count documents
 */
async function count(indexName, query = { match_all: {} }) {
  if (!enabled || !client) {
    return 0;
  }

  try {
    const result = await client.count({
      index: indexName,
      body: { query }
    });

    return result.body.count;
  } catch (error) {
    logger.error(`[elasticsearch] Count failed in ${indexName}:`, error);
    return 0;
  }
}

/**
 * Reindex data (copy from one index to another)
 */
async function reindex(sourceIndex, targetIndex) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    await client.reindex({
      body: {
        source: { index: sourceIndex },
        dest: { index: targetIndex }
      },
      wait_for_completion: true
    });

    logger.info(`[elasticsearch] Reindexed from ${sourceIndex} to ${targetIndex}`);
    return { success: true };
  } catch (error) {
    logger.error('[elasticsearch] Reindex failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get cluster health
 */
async function getClusterHealth() {
  if (!enabled || !client) {
    return { status: 'disabled' };
  }

  try {
    const health = await client.cluster.health();
    return health;
  } catch (error) {
    logger.error('[elasticsearch] Failed to get cluster health:', error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Get index statistics
 */
async function getIndexStats(indexName) {
  if (!enabled || !client) {
    return null;
  }

  try {
    const stats = await client.indices.stats({ index: indexName });
    return stats.body;
  } catch (error) {
    logger.error(`[elasticsearch] Failed to get stats for ${indexName}:`, error);
    return null;
  }
}

/**
 * Pre-configured index mappings
 */

const userMapping = {
  properties: {
    name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    email: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    firstName: { type: 'text' },
    lastName: { type: 'text' },
    role: { type: 'keyword' },
    schoolId: { type: 'keyword' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' }
  }
};

const postMapping = {
  properties: {
    title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    content: { type: 'text' },
    authorId: { type: 'keyword' },
    schoolId: { type: 'keyword' },
    tags: { type: 'keyword' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' }
  }
};

const schoolMapping = {
  properties: {
    name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    address: { type: 'text' },
    city: { type: 'keyword' },
    country: { type: 'keyword' },
    phone: { type: 'keyword' },
    email: { type: 'text' },
    createdAt: { type: 'date' }
  }
};

/**
 * Express middleware for search logging
 */
function searchLoggingMiddleware() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(body) {
      if (req.query && req.query.q) {
        logger.info(`[elasticsearch] Search query: ${req.query.q}`, {
          index: req.params.index || 'unknown',
          user: req.user?.id,
          results: body.hits?.total?.value || 0
        });
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = {
  initialize,
  createIndex,
  deleteIndex,
  indexDocument,
  bulkIndex,
  search,
  simpleSearch,
  getDocument,
  updateDocument,
  deleteDocument,
  getSuggestions,
  getAggregations,
  count,
  reindex,
  getClusterHealth,
  getIndexStats,
  userMapping,
  postMapping,
  schoolMapping,
  searchLoggingMiddleware,
  isEnabled: () => enabled
};
