const crypto = require('crypto');
const { v7: uuidv7 } = require('uuid');
const valkeyService = require('./valkey');

class AgentService {
  constructor() {
    this.tools = {
      search_products: this.searchProducts.bind(this),
      get_product_details: this.getProductDetails.bind(this),
      check_availability: this.checkAvailability.bind(this),
      find_similar: this.findSimilarProducts.bind(this),
      ask_clarification: this.askClarification.bind(this)
    };
  }

  /**
   * Parse natural language query into structured search parameters
   */
  parseQuery(query) {
    const params = {
      keywords: [],
      categories: [],
      tags: [],
      minPrice: null,
      maxPrice: null,
      minRating: null,
      intent: null,
      context: {}
    };

    const queryLower = query.toLowerCase();

    // Intent detection
    if (queryLower.includes('birthday') || queryLower.includes('gift')) {
      params.intent = 'gift_search';
      params.context.occasion = 'birthday';
    }
    if (queryLower.includes('age') || queryLower.includes('year old') || queryLower.includes('years')) {
      const ageMatch = query.match(/(\d+)\s*(?:year|yr)s?\s*old/i);
      if (ageMatch) {
        const age = parseInt(ageMatch[1]);
        params.context.age = age;
        params.context.ageGroup = this.getAgeGroup(age);
      }
    }

    // Extract interests/keywords
    if (queryLower.includes('science')) {
      params.tags.push('science', 'educational');
      params.categories.push('science');
    }
    if (queryLower.includes('robot')) {
      params.tags.push('robotics', 'coding');
      params.categories.push('stem');
    }
    if (queryLower.includes('telescope') || queryLower.includes('astronomy') || queryLower.includes('star')) {
      params.tags.push('astronomy', 'science');
    }
    if (queryLower.includes('chemistry') || queryLower.includes('experiment')) {
      params.tags.push('chemistry', 'experiment', 'science');
    }

    // Price extraction
    const priceMatch = query.match(/\$?\s*(\d+)\s*(?:to|-)?\s*\$?\s*(\d+)?/);
    if (priceMatch) {
      if (queryLower.includes('under') || queryLower.includes('less than') || queryLower.includes('below')) {
        params.maxPrice = parseInt(priceMatch[1]) * 100; // Convert to paise
      } else if (priceMatch[2]) {
        params.minPrice = parseInt(priceMatch[1]) * 100;
        params.maxPrice = parseInt(priceMatch[2]) * 100;
      }
    }

    // Extract recipient info
    if (queryLower.includes('nephew')) {
      params.context.recipient = 'nephew';
    } else if (queryLower.includes('niece')) {
      params.context.recipient = 'niece';
    } else if (queryLower.includes('son')) {
      params.context.recipient = 'son';
    } else if (queryLower.includes('daughter')) {
      params.context.recipient = 'daughter';
    }

    return params;
  }

  getAgeGroup(age) {
    if (age <= 5) return '0-5';
    if (age <= 8) return '5-8';
    if (age <= 12) return '8-12';
    if (age <= 16) return '12-16';
    return '16+';
  }

  /**
   * Execute agent reasoning with multi-step tool use
   */
  async reason(query, conversationContext = null) {
    console.log(`🤖 Agent processing: "${query}"`);

    // Parse the query
    const searchParams = this.parseQuery(query);
    console.log(`📋 Parsed params:`, searchParams);

    // Determine which tools to use
    const toolSequence = [];

    if (query.toLowerCase().includes('show me cheaper') || 
        query.toLowerCase().includes('lower price') ||
        query.toLowerCase().includes('budget option')) {
      // Previous search refinement
      if (conversationContext && conversationContext.lastSearchParams) {
        searchParams.minPrice = conversationContext.lastSearchParams.minPrice || null;
        searchParams.maxPrice = (conversationContext.lastSearchParams.maxPrice || 5000) / 2;
        console.log(`💰 Refining for cheaper options: max ${searchParams.maxPrice}`);
      }
    }

    // Primary tool: search
    toolSequence.push('search_products');

    // Secondary tools based on context
    if (query.toLowerCase().includes('details') || 
        query.toLowerCase().includes('review') ||
        query.toLowerCase().includes('tell me more')) {
      toolSequence.push('get_product_details');
    }

    if (query.toLowerCase().includes('availability') ||
        query.toLowerCase().includes('in stock') ||
        query.toLowerCase().includes('deliver')) {
      toolSequence.push('check_availability');
    }

    if (query.toLowerCase().includes('similar') ||
        query.toLowerCase().includes('alternative') ||
        query.toLowerCase().includes('like this')) {
      toolSequence.push('find_similar');
    }

    // Execute tools
    const results = [];
    for (const tool of toolSequence) {
      const toolResult = await this.tools[tool](searchParams);
      results.push(toolResult);
      console.log(`✅ Tool "${tool}" executed, found ${toolResult.length} results`);
    }

    return {
      searchParams,
      results,
      toolsUsed: toolSequence
    };
  }

  /**
   * Tool implementations
   */
  async searchProducts(params) {
    const products = await valkeyService.searchProducts('', {
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      minRating: params.minRating,
      categories: params.categories,
      tags: params.tags
    });

    return products.map(p => ({
      ...p,
      reason: this.generateReason(p, params)
    }));
  }

  async getProductDetails(params) {
    // In a full implementation, would fetch details for top results
    const results = await this.searchProducts(params);
    
    if (results.length === 0) return [];

    const topProduct = results[0];
    const details = await valkeyService.getProductDetails(topProduct.id);
    
    return details ? [details] : [];
  }

  async checkAvailability(params) {
    const results = await this.searchProducts(params);
    
    if (results.length === 0) return [];

    const availabilityData = await Promise.all(
      results.map(p => valkeyService.checkAvailability(p.id))
    );

    return results.map((p, i) => ({
      ...p,
      availability: availabilityData[i]
    }));
  }

  async findSimilarProducts(params) {
    const results = await this.searchProducts(params);
    
    if (results.length === 0) return [];

    const topProduct = results[0];
    const similar = await valkeyService.findSimilarProducts(topProduct.id, 3);
    
    return similar;
  }

  async askClarification(question, options = []) {
    return {
      type: 'clarification',
      question,
      options
    };
  }

  /**
   * Generate personalized reason for recommendation
   */
  generateReason(product, searchParams) {
    const reasons = [];

    if (searchParams.context.age) {
      reasons.push(`Suitable for ages ${searchParams.context.ageGroup}`);
    }

    if (searchParams.tags.length > 0) {
      const matchingTags = searchParams.tags.filter(t => 
        product.tags.includes(t)
      );
      if (matchingTags.length > 0) {
        reasons.push(`Features: ${matchingTags.join(', ')}`);
      }
    }

    if (product.rating >= 4.5) {
      reasons.push(`⭐ Highly rated (${product.rating}/5, ${product.reviews} reviews)`);
    }

    if (searchParams.context.recipient) {
      reasons.push(`Perfect gift for a ${searchParams.context.recipient}`);
    }

    if (searchParams.context.occasion === 'birthday') {
      reasons.push('Great birthday gift option');
    }

    return reasons.length > 0 
      ? reasons.join(' • ')
      : 'Recommended based on your search criteria';
  }

  /**
   * Create conversational response
   */
  async generateResponse(query, agentResult, conversationTurns = []) {
    const { results, searchParams, toolsUsed } = agentResult;

    if (results.length === 0) {
      return {
        response: `I couldn't find products matching "${query}". Could you provide more details? For example, what's your budget or which specific interests should I focus on?`,
        results: [],
        followUp: 'Tell me more about your preferences',
        context: searchParams
      };
    }

    // Build response based on results
    let responseText = this.buildResponseText(query, results, searchParams);

    // Generate follow-up question
    const followUp = this.generateFollowUp(searchParams, conversationTurns.length);

    return {
      response: responseText,
      results: results.slice(0, 5).map(r => ({
        productId: r.id,
        name: r.name,
        price: r.price,
        rating: r.rating,
        reason: r.reason
      })),
      followUp,
      context: {
        intent: searchParams.intent,
        refinements_available: true,
        toolsUsed
      }
    };
  }

  buildResponseText(query, results, searchParams) {
    let text = '';

    if (searchParams.context.occasion === 'birthday') {
      if (searchParams.context.recipient) {
        text = `Here are some great ${searchParams.context.ageGroup ? `${searchParams.context.ageGroup} age` : ''} gift options for your ${searchParams.context.recipient}'s birthday! I focused on educational and engaging products:`;
      }
    } else if (searchParams.categories.length > 0) {
      text = `Here are the best ${searchParams.categories.join(' and ')} products that match your needs:`;
    } else {
      text = 'Here are the products I found for you:';
    }

    return text;
  }

  generateFollowUp(searchParams, turnCount = 0) {
    const followUps = [
      'Would you like me to filter by a specific budget?',
      'Should I show you options with different features?',
      'Would you like to see similar alternatives?',
      'Do you want to check availability for any of these?',
      'Should I focus on a different category?'
    ];

    return followUps[turnCount % followUps.length];
  }

  /**
   * Check if query is a refinement of previous search
   */
  isRefinement(currentQuery, previousParams) {
    const refinementKeywords = ['cheaper', 'expensive', 'more', 'less', 'show me', 'other', 'different', 'better'];
    const isRefinement = refinementKeywords.some(keyword => 
      currentQuery.toLowerCase().includes(keyword)
    );

    return isRefinement && previousParams;
  }

  /**
   * Merge conversation context into search params
   */
  mergeContext(currentParams, conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) {
      return currentParams;
    }

    const lastAgentTurn = conversationHistory
      .reverse()
      .find(turn => turn.role === 'agent' && turn.searchParams);

    if (!lastAgentTurn) {
      return currentParams;
    }

    // Merge context while allowing overrides
    return {
      ...lastAgentTurn.searchParams,
      ...currentParams,
      context: {
        ...lastAgentTurn.searchParams.context,
        ...currentParams.context
      }
    };
  }
}

module.exports = new AgentService();
