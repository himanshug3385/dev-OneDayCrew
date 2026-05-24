const { createClient } = require('redis');
const { commandOptions } = require('redis');

class ValkeyService {
  constructor() {
    this.client = null;
  }

  async connect() {
    const valkeyUrl = process.env.VALKEY_URL || 'redis://localhost:6379';
    
    this.client = createClient({
      url: valkeyUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.log('Max retries exceeded');
            return new Error('Max retries exceeded');
          }
          return retries * 50;
        }
      }
    });

    this.client.on('error', (err) => console.error('Valkey Client Error', err));
    this.client.on('connect', () => console.log('Valkey connected'));
    
    await this.client.connect();
  }

  async setConversation(sessionId, conversationData) {
    const key = `conversation:${sessionId}`;
    const ttl = 1800; // 30 minutes
    
    try {
      await this.client.json.set(key, '$', conversationData);
      await this.client.expire(key, ttl);
      return true;
    } catch (err) {
      console.error(`Error setting conversation ${sessionId}:`, err);
      throw err;
    }
  }

  async getConversation(sessionId) {
    const key = `conversation:${sessionId}`;
    
    try {
      const data = await this.client.json.get(key);
      return data;
    } catch (err) {
      console.error(`Error getting conversation ${sessionId}:`, err);
      return null;
    }
  }

  async appendToConversation(sessionId, turn) {
    const key = `conversation:${sessionId}`;
    const conversation = await this.getConversation(sessionId);
    
    if (!conversation) {
      throw new Error(`Conversation ${sessionId} not found`);
    }

    conversation.turns.push(turn);
    await this.setConversation(sessionId, conversation);
    return conversation;
  }

  async setCacheResult(queryHash, result, ttl = 300) {
    const key = `agent_cache:${queryHash}`;
    
    try {
      await this.client.setEx(key, ttl, JSON.stringify(result));
      return true;
    } catch (err) {
      console.error(`Error caching result:`, err);
      throw err;
    }
  }

  async getCacheResult(queryHash) {
    const key = `agent_cache:${queryHash}`;
    
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`Error getting cached result:`, err);
      return null;
    }
  }

  async setUserPreferences(userId, preferences) {
    const key = `user_preferences:${userId}`;
    
    try {
      await this.client.json.set(key, '$', preferences);
      return true;
    } catch (err) {
      console.error(`Error setting user preferences:`, err);
      throw err;
    }
  }

  async getUserPreferences(userId) {
    const key = `user_preferences:${userId}`;
    
    try {
      const data = await this.client.json.get(key);
      return data;
    } catch (err) {
      console.error(`Error getting user preferences:`, err);
      return null;
    }
  }

  getMockProducts() {
    return [
      {
        id: 'product:0192d4e6-2c4e-7a6b-8d8f-0a1b2c3d4e5f',
        name: 'National Geographic Science Kit',
        price: 2499,
        category: 'science',
        tags: ['educational', 'kids', 'experiment'],
        rating: 4.8,
        reviews: 156,
        description: 'Complete science experiment kit for ages 8-12'
      },
      {
        id: 'product:0192d4e6-3d5f-7b8c-9e0a-1b2c3d4e5f6a',
        name: 'Kids Starter Telescope',
        price: 3999,
        category: 'science',
        tags: ['astronomy', 'educational', 'kids'],
        rating: 4.6,
        reviews: 89,
        description: 'Perfect telescope for young astronomers'
      },
      {
        id: 'product:0192d4e6-4e6a-7c9d-8f1b-2c3d4e5f6a7b',
        name: 'LEGO Robotics Set',
        price: 4299,
        category: 'stem',
        tags: ['robotics', 'coding', 'kids', 'educational'],
        rating: 4.9,
        reviews: 234,
        description: 'Build and program your own robots'
      },
      {
        id: 'product:0192d4e6-5f7b-7d0e-8a2c-3d4e5f6a7b8c',
        name: 'Chemistry Laboratory Set',
        price: 1999,
        category: 'science',
        tags: ['chemistry', 'educational', 'kids', 'experiment'],
        rating: 4.5,
        reviews: 67,
        description: 'Safe chemistry experiments for young scientists'
      },
      {
        id: 'product:0192d4e6-6a8c-7e1f-9b3d-4e5f6a7b8c9d',
        name: 'Crystal Growing Kit',
        price: 1499,
        category: 'science',
        tags: ['crystal', 'experiment', 'educational', 'kids'],
        rating: 4.7,
        reviews: 145,
        description: 'Grow beautiful crystals at home'
      }
    ];
  }

  // Full-text + structured filter search (FT.SEARCH integration point)
  async searchProducts(query, filters = {}) {
    let results = [...this.getMockProducts()];

    const q = (query || '').toLowerCase().trim();
    if (q) {
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q)) ||
          p.category.includes(q)
      );
    }

    if (filters.minPrice != null) {
      results = results.filter((p) => p.price >= filters.minPrice);
    }
    if (filters.maxPrice != null) {
      results = results.filter((p) => p.price <= filters.maxPrice);
    }
    if (filters.minRating != null) {
      results = results.filter((p) => p.rating >= filters.minRating);
    }
    if (filters.categories?.length > 0) {
      results = results.filter((p) =>
        filters.categories.some(
          (c) => p.category === c || p.tags.includes(c)
        )
      );
    }
    if (filters.tags?.length > 0) {
      results = results.filter((p) =>
        filters.tags.some(
          (tag) =>
            p.tags.includes(tag) ||
            p.category === tag ||
            p.name.toLowerCase().includes(tag)
        )
      );
    }

    return results.sort((a, b) => b.rating - a.rating);
  }

  // Vector / semantic similarity (idx:intent_vectors KNN integration point)
  async semanticSearch(naturalLanguageQuery, limit = 10) {
    const q = naturalLanguageQuery.toLowerCase();
    const scored = this.getMockProducts().map((p) => {
      const text = `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase();
      const tokens = q.split(/\s+/).filter((t) => t.length > 2);
      const hits = tokens.filter((t) => text.includes(t)).length;
      return { product: p, score: hits / Math.max(tokens.length, 1) };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.product);
  }

  async getProductDetails(productId) {
    // Mock product details
    const products = {
      'product:0192d4e6-2c4e-7a6b-8d8f-0a1b2c3d4e5f': {
        id: 'product:0192d4e6-2c4e-7a6b-8d8f-0a1b2c3d4e5f',
        name: 'National Geographic Science Kit',
        price: 2499,
        category: 'science',
        tags: ['educational', 'kids', 'experiment'],
        rating: 4.8,
        reviews: 156,
        description: 'Complete science experiment kit for ages 8-12',
        inStock: true,
        reviews_list: [
          { author: 'Priya S.', rating: 5, text: 'My son loved this! Great quality.' },
          { author: 'Amit K.', rating: 4, text: 'Good value for money, very educational.' }
        ]
      }
    };

    return products[productId] || null;
  }

  async findSimilarProducts(productId, limit = 5) {
    // Mock similar products
    const products = await this.searchProducts('');
    const currentProduct = products.find(p => p.id === productId);
    
    if (!currentProduct) return [];

    return products
      .filter(p => p.id !== productId && 
              p.category === currentProduct.category)
      .slice(0, limit);
  }

  async checkAvailability(productId, postalCode = null) {
    return {
      productId,
      inStock: true,
      quantity: Math.floor(Math.random() * 100) + 1,
      deliveryDays: Math.floor(Math.random() * 5) + 1,
      deliveryDate: new Date(Date.now() + Math.random() * 5 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
    }
  }
}

module.exports = new ValkeyService();
