const crypto = require('crypto');
const valkeyService = require('./valkey');

class AgentService {
  constructor() {
    this.tools = {
      search_products: this.searchProducts.bind(this),
      semantic_search: this.semanticSearch.bind(this),
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

    // Age: "10 year old", "10-year-old", "10 years"
    const ageMatch =
      query.match(/(\d+)[\s-]*(?:year|yr)s?[\s-]*old/i) ||
      query.match(/(\d+)\s*(?:year|yr)s?\s*old/i);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      params.context.age = age;
      params.context.ageGroup = this.getAgeGroup(age);
    }

    // Extract interests/keywords
    if (queryLower.includes('science')) {
      params.tags.push('science', 'educational');
      params.categories.push('science');
      params.keywords.push('science');
    }
    if (queryLower.includes('robot')) {
      params.tags.push('robotics', 'coding');
      params.categories.push('stem');
      params.keywords.push('robotics');
    }
    if (
      queryLower.includes('telescope') ||
      queryLower.includes('astronomy') ||
      queryLower.includes('star')
    ) {
      params.tags.push('astronomy', 'science');
      params.keywords.push('telescope', 'astronomy');
    }
    if (queryLower.includes('chemistry') || queryLower.includes('experiment')) {
      params.tags.push('chemistry', 'experiment', 'science');
      params.keywords.push('chemistry');
    }

    // Rating
    if (
      queryLower.includes('highly rated') ||
      queryLower.includes('top rated') ||
      queryLower.includes('best rated')
    ) {
      params.minRating = 4.5;
    }

    // Price extraction (amounts in dollars → stored as cents/paise-style units)
    const underMatch = query.match(
      /(?:under|less than|below)\s*\$?\s*(\d+)/i
    );
    if (underMatch) {
      params.maxPrice = parseInt(underMatch[1], 10) * 100;
    }

    const rangeMatch = query.match(/\$?\s*(\d+)\s*(?:to|-)\s*\$?\s*(\d+)/i);
    if (rangeMatch) {
      params.minPrice = parseInt(rangeMatch[1], 10) * 100;
      params.maxPrice = parseInt(rangeMatch[2], 10) * 100;
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

    // Budget keywords without explicit number
    if (queryLower.includes('cheap') || queryLower.includes('affordable')) {
      params.context.budgetPreference = 'low';
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

  isRefinementQuery(query) {
    const q = query.toLowerCase();
    return (
      q.includes('cheaper') ||
      q.includes('lower price') ||
      q.includes('budget option') ||
      q.includes('more expensive') ||
      q.includes('show me') ||
      q.includes('filter') ||
      q.includes('instead')
    );
  }

  applyRefinement(query, searchParams, conversationContext) {
    const q = query.toLowerCase();
    const previous = conversationContext?.lastSearchParams;
    if (!previous) return searchParams;

    const merged = {
      ...previous,
      ...searchParams,
      categories: searchParams.categories.length
        ? searchParams.categories
        : previous.categories,
      tags: searchParams.tags.length ? searchParams.tags : previous.tags,
      keywords: searchParams.keywords.length
        ? searchParams.keywords
        : previous.keywords,
      context: {
        ...previous.context,
        ...searchParams.context
      }
    };

    if (
      q.includes('cheaper') ||
      q.includes('lower price') ||
      q.includes('budget option') ||
      q.includes('affordable')
    ) {
      const prevMax = previous.maxPrice;
      const baseline =
        prevMax ||
        (conversationContext?.lastMaxResultPrice
          ? conversationContext.lastMaxResultPrice
          : 5000);
      merged.maxPrice = Math.floor(baseline * 0.6);
      merged.context.budgetPreference = 'low';
    }

    if (q.includes('more expensive') || q.includes('premium')) {
      const prevMin = previous.minPrice || 0;
      merged.minPrice = Math.max(prevMin, (previous.maxPrice || 3000) + 1);
      merged.maxPrice = null;
    }

    return merged;
  }

  /**
   * Execute agent reasoning with multi-step tool use
   */
  async reason(query, conversationContext = null, conversationHistory = []) {
    console.log(`🤖 Agent processing: "${query}"`);

    let searchParams = this.parseQuery(query);

    if (conversationHistory.length > 0) {
      searchParams = this.mergeContext(searchParams, conversationHistory);
    }

    if (
      this.isRefinementQuery(query) &&
      (conversationContext?.lastSearchParams || conversationHistory.length > 0)
    ) {
      searchParams = this.applyRefinement(
        query,
        searchParams,
        conversationContext
      );
    }

    console.log(`📋 Parsed params:`, searchParams);

    // Cache lookup
    const queryHash = crypto
      .createHash('md5')
      .update(JSON.stringify({ query, searchParams }))
      .digest('hex');
    const cached = await valkeyService.getCacheResult(queryHash);
    if (cached?.results) {
      console.log(`⚡ Cache hit for query hash ${queryHash}`);
      return {
        searchParams,
        products: cached.results,
        toolsUsed: ['cache'],
        fromCache: true
      };
    }

    const toolSequence = [];
    const toolResults = {};
    let products = [];

    const useSemantic =
      searchParams.keywords.length === 0 &&
      !searchParams.categories.length &&
      query.split(' ').length > 4;

    if (useSemantic) {
      toolSequence.push('semantic_search');
    } else {
      toolSequence.push('search_products');
    }

    if (
      query.toLowerCase().includes('details') ||
      query.toLowerCase().includes('review') ||
      query.toLowerCase().includes('tell me more')
    ) {
      toolSequence.push('get_product_details');
    }

    if (
      query.toLowerCase().includes('availability') ||
      query.toLowerCase().includes('in stock') ||
      query.toLowerCase().includes('deliver')
    ) {
      toolSequence.push('check_availability');
    }

    if (
      query.toLowerCase().includes('similar') ||
      query.toLowerCase().includes('alternative') ||
      query.toLowerCase().includes('like this')
    ) {
      toolSequence.push('find_similar');
    }

    for (const tool of toolSequence) {
      const toolResult = await this.tools[tool](searchParams, query);
      toolResults[tool] = toolResult;

      if (tool === 'search_products' || tool === 'semantic_search') {
        products = toolResult;
      } else if (tool === 'find_similar' && toolResult.length > 0) {
        products = toolResult;
      } else if (
        (tool === 'check_availability' || tool === 'get_product_details') &&
        toolResult.length > 0
      ) {
        products = toolResult;
      }

      console.log(
        `✅ Tool "${tool}" executed, found ${Array.isArray(toolResult) ? toolResult.length : 1} result(s)`
      );
    }

    // Sort by price for budget refinements
    if (searchParams.context.budgetPreference === 'low') {
      products = [...products].sort((a, b) => a.price - b.price);
    }

    return {
      searchParams,
      products,
      toolResults,
      toolsUsed: toolSequence,
      queryHash
    };
  }

  /**
   * Tool implementations
   */
  async searchProducts(params) {
    const products = await valkeyService.searchProducts(
      params.keywords.join(' '),
      {
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        minRating: params.minRating,
        categories: params.categories,
        tags: params.tags
      }
    );

    return products.map((p) => ({
      ...p,
      reason: this.generateReason(p, params)
    }));
  }

  async semanticSearch(params, naturalLanguageQuery = '') {
    const products = await valkeyService.semanticSearch(
      naturalLanguageQuery || params.keywords.join(' '),
      10
    );

    return products.map((p) => ({
      ...p,
      reason: this.generateReason(p, params)
    }));
  }

  async getProductDetails(params) {
    const results = await this.searchProducts(params);

    if (results.length === 0) return [];

    const topProduct = results[0];
    const details = await valkeyService.getProductDetails(topProduct.id);

    return details
      ? [{ ...details, reason: topProduct.reason }]
      : [results[0]];
  }

  async checkAvailability(params) {
    const results = await this.searchProducts(params);

    if (results.length === 0) return [];

    const availabilityData = await Promise.all(
      results.slice(0, 5).map((p) => valkeyService.checkAvailability(p.id))
    );

    return results.slice(0, 5).map((p, i) => ({
      ...p,
      availability: availabilityData[i],
      reason: `${p.reason} • In stock: ${availabilityData[i].inStock ? 'Yes' : 'No'}`
    }));
  }

  async findSimilarProducts(params) {
    const results = await this.searchProducts(params);

    if (results.length === 0) return [];

    const topProduct = results[0];
    const similar = await valkeyService.findSimilarProducts(topProduct.id, 5);

    return similar.map((p) => ({
      ...p,
      reason: `Similar to ${topProduct.name}`
    }));
  }

  askClarification(question, options = []) {
    return {
      type: 'clarification',
      question,
      options
    };
  }

  generateReason(product, searchParams) {
    const reasons = [];

    if (searchParams.context?.ageGroup) {
      reasons.push(`Designed for ages ${searchParams.context.ageGroup}`);
    }

    if (searchParams.tags?.length > 0) {
      const matchingTags = searchParams.tags.filter((t) =>
        product.tags.includes(t)
      );
      if (matchingTags.length > 0) {
        reasons.push(`Matches: ${matchingTags.join(', ')}`);
      }
    }

    if (product.rating >= 4.5) {
      reasons.push(
        `Highly rated (${product.rating}/5, ${product.reviews} reviews)`
      );
    }

    if (searchParams.context?.recipient) {
      reasons.push(`Great for your ${searchParams.context.recipient}`);
    }

    if (searchParams.context?.occasion === 'birthday') {
      reasons.push('Ideal birthday gift');
    }

    if (searchParams.context?.budgetPreference === 'low') {
      reasons.push('Budget-friendly option from your previous search');
    }

    return reasons.length > 0
      ? reasons.join(' • ')
      : 'Recommended based on your search criteria';
  }

  async generateResponse(query, agentResult, conversationTurns = []) {
    const { products, searchParams, toolsUsed } = agentResult;

    if (!products || products.length === 0) {
      return {
        response: `I couldn't find products matching "${query}". Could you share a budget or specific interests?`,
        results: [],
        followUp:
          'For example: chemistry kits, astronomy, or robotics — and a price range?',
        context: {
          intent: searchParams.intent,
          refinements_available: false
        }
      };
    }

    const responseText = this.buildResponseText(query, products, searchParams);
    const followUp = this.generateFollowUp(searchParams, conversationTurns.length);

    return {
      response: responseText,
      results: products.slice(0, 5).map((r) => ({
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
        toolsUsed,
        recipient: searchParams.context?.recipient,
        age: searchParams.context?.age,
        interests: searchParams.tags
      }
    };
  }

  buildResponseText(query, results, searchParams) {
    if (searchParams.context?.occasion === 'birthday') {
      const agePart = searchParams.context.ageGroup
        ? `${searchParams.context.ageGroup} `
        : '';
      const recipient = searchParams.context.recipient || 'recipient';
      return `Here are some great ${agePart}science gift options for your ${recipient}'s birthday! I focused on educational and engaging products:`;
    }

    if (searchParams.context?.budgetPreference === 'low') {
      return 'Here are more affordable options based on your previous search:';
    }

    if (searchParams.categories.length > 0) {
      return `Here are the best ${searchParams.categories.join(' and ')} products for your needs:`;
    }

    return 'Here are the products I found for you:';
  }

  generateFollowUp(searchParams, turnCount = 0) {
    const followUps = [
      'Would you like me to filter by a specific budget, or focus on chemistry, astronomy, or robotics?',
      'Should I show cheaper or premium alternatives?',
      'Would you like to see similar products or check delivery availability?',
      'Want me to narrow results by rating or brand?'
    ];

    if (searchParams.context?.budgetPreference === 'low') {
      return 'Would you like even lower-priced options, or products in a specific science area?';
    }

    return followUps[turnCount % followUps.length];
  }

  mergeContext(currentParams, conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) {
      return currentParams;
    }

    const lastAgentTurn = [...conversationHistory]
      .reverse()
      .find((turn) => turn.role === 'agent' && turn.searchParams);

    if (!lastAgentTurn) {
      return currentParams;
    }

    return {
      ...lastAgentTurn.searchParams,
      ...currentParams,
      categories: currentParams.categories.length
        ? currentParams.categories
        : lastAgentTurn.searchParams.categories,
      tags: currentParams.tags.length
        ? currentParams.tags
        : lastAgentTurn.searchParams.tags,
      context: {
        ...lastAgentTurn.searchParams.context,
        ...currentParams.context
      }
    };
  }
}

module.exports = new AgentService();
