const crypto = require('crypto');
const valkeyService = require('./valkey');

/**
 * Challenge 14 agent — NLU, multi-step tools, Valkey conversation memory.
 * Spec tools: search_products, filter_by_price, get_reviews, check_availability, get_similar
 */
class AgentService {
  constructor() {
    this.tools = {
      search_products: this.searchProducts.bind(this),
      semantic_search: this.semanticSearch.bind(this),
      filter_by_price: this.filterByPrice.bind(this),
      get_reviews: this.getReviews.bind(this),
      get_product_details: this.getProductDetails.bind(this),
      check_availability: this.checkAvailability.bind(this),
      get_similar: this.getSimilarProducts.bind(this),
      ask_clarification: this.askClarification.bind(this)
    };
  }

  /**
   * Parse natural language into structured search parameters (Challenge 14 NLU).
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

    if (queryLower.includes('birthday') || queryLower.includes('gift')) {
      params.intent = 'gift_search';
      params.context.occasion = 'birthday';
    }

    const ageMatch =
      query.match(/(\d+)[\s-]*(?:year|yr)s?[\s-]*old/i) ||
      query.match(/(\d+)\s*(?:year|yr)s?\s*old/i);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      params.context.age = age;
      params.context.ageGroup = this.getAgeGroup(age);
      params.context.priceRange = params.context.priceRange || this.defaultPriceRangeForAge(age);
    }

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

    if (
      queryLower.includes('highly rated') ||
      queryLower.includes('top rated') ||
      queryLower.includes('best rated')
    ) {
      params.minRating = 4.5;
    }

    const underMatch = query.match(/(?:under|less than|below)\s*\$?\s*(\d+)/i);
    if (underMatch) {
      params.maxPrice = parseInt(underMatch[1], 10) * 100;
    }

    const rangeMatch = query.match(/\$?\s*(\d+)\s*(?:to|-)\s*\$?\s*(\d+)/i);
    if (rangeMatch) {
      params.minPrice = parseInt(rangeMatch[1], 10) * 100;
      params.maxPrice = parseInt(rangeMatch[2], 10) * 100;
    }

    if (queryLower.includes('nephew')) params.context.recipient = 'nephew';
    else if (queryLower.includes('niece')) params.context.recipient = 'niece';
    else if (queryLower.includes('son')) params.context.recipient = 'son';
    else if (queryLower.includes('daughter')) params.context.recipient = 'daughter';

    if (queryLower.includes('cheap') || queryLower.includes('affordable')) {
      params.context.budgetPreference = 'low';
    }

    params.keywords = this.extractKeywordsFromUserInput(query, params);
    return params;
  }

  defaultPriceRangeForAge(age) {
    if (age <= 8) return [500, 3000];
    if (age <= 12) return [500, 5000];
    return [1000, 8000];
  }

  extractKeywordsFromUserInput(query, params) {
    const stop = new Set([
      'i', 'me', 'my', 'a', 'an', 'the', 'for', 'to', 'and', 'or', 'is', 'are',
      'need', 'want', 'show', 'find', 'get', 'some', 'any', 'with', 'who', 'that',
      'this', 'what', 'how', 'can', 'you', 'please', 'like', 'good', 'best', 'only',
      'options', 'cheaper', 'expensive', 'me', 'let'
    ]);
    const fromQuery = query
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));

    return [...new Set([...params.keywords, ...fromQuery])].slice(0, 12);
  }

  getAgeGroup(age) {
    if (age <= 5) return '0-5';
    if (age <= 8) return '5-8';
    if (age <= 12) return '8-12';
    if (age <= 16) return '12-16';
    return '16+';
  }

  /** Only true follow-ups — not "show me robotics" on a fresh search */
  isRefinementQuery(query) {
    const q = query.toLowerCase();
    return (
      q.includes('cheaper') ||
      q.includes('lower price') ||
      q.includes('budget option') ||
      q.includes('more expensive') ||
      q.includes('premium') ||
      q.includes('instead') ||
      q.includes('filter by price') ||
      q.includes('affordable options')
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
      keywords: previous.keywords?.length ? previous.keywords : searchParams.keywords,
      context: { ...previous.context, ...searchParams.context }
    };

    if (
      q.includes('cheaper') ||
      q.includes('lower price') ||
      q.includes('budget option') ||
      q.includes('affordable')
    ) {
      const baseline =
        previous.maxPrice ||
        conversationContext?.lastMaxResultPrice ||
        5000;
      merged.maxPrice = Math.floor(baseline * 0.65);
      merged.minPrice = null;
      merged.context.budgetPreference = 'low';
      merged.context.refinement = 'price_lower';
    }

    if (q.includes('more expensive') || q.includes('premium')) {
      merged.minPrice = (previous.maxPrice || conversationContext?.lastMaxResultPrice || 2000) + 1;
      merged.maxPrice = null;
      merged.context.refinement = 'price_higher';
    }

    return merged;
  }

  needsClarification(query, searchParams, conversationContext) {
    if (conversationContext?.lastSearchParams) return false;
    if (this.isRefinementQuery(query)) return false;

    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);

    const hasSignal =
      searchParams.intent ||
      searchParams.categories.length > 0 ||
      searchParams.tags.length > 0 ||
      searchParams.context.age ||
      searchParams.maxPrice != null;

    if (hasSignal) return false;

    if (words.length <= 5) return true;

    return false;
  }

  buildClarification(query, searchParams) {
    if (searchParams.intent === 'gift_search' || query.toLowerCase().includes('gift')) {
      return this.askClarification(
        'Who is the gift for, and what are their interests or age? For example: "10-year-old nephew who likes science".',
        [
          'Birthday gift for a child who likes science',
          'Gift under $50 for a teenager',
          'Educational toy for ages 8–12'
        ]
      );
    }
    return this.askClarification(
      'What type of product are you looking for? Mention category, budget, or who it is for.',
      [
        'Science kits for kids',
        'Robotics under $50',
        'Highly rated chemistry sets'
      ]
    );
  }

  /**
   * Multi-step tool plan (Challenge 14): combine searches, filters, reviews, etc.
   */
  planToolSequence(query, searchParams, conversationContext) {
    const q = query.toLowerCase();

    if (this.needsClarification(query, searchParams, conversationContext)) {
      return ['ask_clarification'];
    }

    const sequence = [];
    const useSemantic =
      query.split(/\s+/).length > 8 &&
      searchParams.categories.length === 0 &&
      !this.isRefinementQuery(query);

    sequence.push(useSemantic ? 'semantic_search' : 'search_products');

    const needsPriceFilter =
      searchParams.maxPrice != null ||
      searchParams.minPrice != null ||
      searchParams.context?.budgetPreference === 'low' ||
      searchParams.context?.refinement?.startsWith('price') ||
      q.includes('under') ||
      q.includes('cheaper') ||
      q.includes('budget');

    if (needsPriceFilter) {
      sequence.push('filter_by_price');
    }

    if (
      q.includes('review') ||
      q.includes('reviews') ||
      q.includes('rated') ||
      q.includes('feedback')
    ) {
      sequence.push('get_reviews');
    }

    if (
      q.includes('availability') ||
      q.includes('in stock') ||
      q.includes('deliver') ||
      q.includes('shipping')
    ) {
      sequence.push('check_availability');
    }

    if (
      q.includes('similar') ||
      q.includes('alternative') ||
      q.includes('like this')
    ) {
      sequence.push('get_similar');
    }

    return sequence;
  }

  async reason(query, conversationContext = null, conversationHistory = [], opts = {}) {
    const liveSearch = opts.liveSearch !== false;
    const started = Date.now();
    console.log(`🤖 Agent processing user input: "${query}"`);

    let searchParams = this.parseQuery(query);

    if (conversationHistory.length > 0) {
      searchParams = this.mergeContext(searchParams, conversationHistory);
    }

    if (
      this.isRefinementQuery(query) &&
      (conversationContext?.lastSearchParams || conversationHistory.length > 0)
    ) {
      searchParams = this.applyRefinement(query, searchParams, conversationContext);
      console.log(`🔗 Refinement applied from previous Valkey context`);
    }

    console.log(`📋 Structured search params:`, JSON.stringify(searchParams, null, 2));

    const queryHash = crypto
      .createHash('md5')
      .update(JSON.stringify({ query, searchParams }))
      .digest('hex');

    if (!liveSearch) {
      const cached = await valkeyService.getCacheResult(queryHash);
      if (cached?.results) {
        return {
          searchParams,
          products: this.normalizeCachedProducts(cached.results),
          toolsUsed: ['agent_cache'],
          fromCache: true,
          resultSource: 'valkey_cache',
          queryHash,
          latencyMs: Date.now() - started
        };
      }
    }

    const toolSequence = this.planToolSequence(
      query,
      searchParams,
      conversationContext
    );

    if (toolSequence[0] === 'ask_clarification') {
      const clarification = this.buildClarification(query, searchParams);
      return {
        searchParams,
        products: [],
        clarification,
        toolsUsed: ['ask_clarification'],
        toolResults: { ask_clarification: clarification },
        queryHash,
        fromCache: false,
        resultSource: 'clarification',
        latencyMs: Date.now() - started
      };
    }

    const toolResults = {};
    let products = [];

    for (const tool of toolSequence) {
      let toolResult;

      if (tool === 'filter_by_price') {
        toolResult = await this.filterByPrice(searchParams, products, query);
        products = toolResult;
      } else if (tool === 'get_reviews') {
        toolResult = await this.getReviews(searchParams, products, query);
        products = toolResult.length ? toolResult : products;
      } else if (tool === 'check_availability') {
        toolResult = await this.checkAvailability(searchParams, products, query);
        products = toolResult.length ? toolResult : products;
      } else if (tool === 'get_similar') {
        toolResult = await this.getSimilarProducts(searchParams, products, query);
        products = toolResult.length ? toolResult : products;
      } else {
        toolResult = await this.tools[tool](searchParams, query);
        if (
          tool === 'search_products' ||
          tool === 'semantic_search'
        ) {
          products = toolResult;
        }
      }

      toolResults[tool] = toolResult;
      console.log(
        `✅ Tool "${tool}" → ${Array.isArray(toolResult) ? toolResult.length : 1} result(s)`
      );
    }

    if (searchParams.context?.budgetPreference === 'low') {
      products = [...products].sort((a, b) => a.price - b.price);
    }

    return {
      searchParams,
      products,
      toolResults,
      toolsUsed: toolSequence,
      queryHash,
      fromCache: false,
      resultSource: 'live_search',
      latencyMs: Date.now() - started
    };
  }

  normalizeCachedProducts(results) {
    return results.map((r) => ({
      id: r.productId || r.id,
      name: r.name,
      price: r.price,
      rating: r.rating,
      reason: r.reason,
      tags: r.tags || []
    }));
  }

  async searchProducts(params, naturalLanguageQuery = '') {
    const isRefinement = params.context?.refinement;
    const searchText = isRefinement
      ? ''
      : naturalLanguageQuery.trim() || params.keywords.join(' ') || '';

    const products = await valkeyService.searchProducts(searchText, {
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      minRating: params.minRating,
      categories: params.categories,
      tags: params.tags
    });

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

  async filterByPrice(params, existingProducts = [], naturalLanguageQuery = '') {
    let products = existingProducts?.length
      ? existingProducts
      : await this.searchProducts(params, naturalLanguageQuery);

    if (params.maxPrice != null) {
      products = products.filter((p) => p.price <= params.maxPrice);
    }
    if (params.minPrice != null) {
      products = products.filter((p) => p.price >= params.minPrice);
    }

    return products.map((p) => ({
      ...p,
      reason: `${p.reason} • Price ₹${p.price} fits your ${
        params.maxPrice != null ? `budget (max ₹${params.maxPrice})` : 'criteria'
      }`
    }));
  }

  async getReviews(params, existingProducts = [], naturalLanguageQuery = '') {
    const base = existingProducts?.length
      ? existingProducts
      : await this.searchProducts(params, naturalLanguageQuery);

    const enriched = [];
    for (const p of base.slice(0, 5)) {
      const details = await valkeyService.getProductDetails(p.id);
      const topReview = details?.reviews_list?.[0];
      const reviewText = topReview
        ? `"${topReview.text}" — ${topReview.author} (${topReview.rating}/5)`
        : `${p.reviews || 0} customer reviews`;
      enriched.push({
        ...p,
        reason: `${p.reason} • ${reviewText}`
      });
    }
    return enriched;
  }

  async getProductDetails(params) {
    const results = await this.searchProducts(params);
    if (!results.length) return [];
    const details = await valkeyService.getProductDetails(results[0].id);
    return details ? [{ ...details, reason: results[0].reason }] : [results[0]];
  }

  async checkAvailability(params, existingProducts = [], naturalLanguageQuery = '') {
    const results = existingProducts?.length
      ? existingProducts
      : await this.searchProducts(params, naturalLanguageQuery);

    if (!results.length) return [];

    const availabilityData = await Promise.all(
      results.slice(0, 5).map((p) => valkeyService.checkAvailability(p.id))
    );

    return results.slice(0, 5).map((p, i) => ({
      ...p,
      availability: availabilityData[i],
      reason: `${p.reason} • In stock: ${availabilityData[i].inStock ? 'Yes' : 'No'}, delivers in ~${availabilityData[i].deliveryDays} day(s)`
    }));
  }

  async getSimilarProducts(params, existingProducts = [], naturalLanguageQuery = '') {
    const results = existingProducts?.length
      ? existingProducts
      : await this.searchProducts(params, naturalLanguageQuery);

    if (!results.length) return [];

    const similar = await valkeyService.findSimilarProducts(results[0].id, 5);
    return similar.map((p) => ({
      ...p,
      reason: this.generateReason(p, params) + ` • Similar to ${results[0].name}`
    }));
  }

  askClarification(question, options = []) {
    return { type: 'clarification', question, options };
  }

  generateReason(product, searchParams) {
    const reasons = [];

    if (searchParams.context?.ageGroup) {
      reasons.push(`Suitable for ages ${searchParams.context.ageGroup}`);
    }
    if (searchParams.tags?.length > 0) {
      const matchingTags = searchParams.tags.filter((t) =>
        product.tags?.includes(t)
      );
      if (matchingTags.length > 0) {
        reasons.push(`Matches interests: ${matchingTags.join(', ')}`);
      }
    }
    if (product.rating >= 4.5) {
      reasons.push(
        `Highly rated (${product.rating}/5, ${product.reviews} reviews)`
      );
    }
    if (searchParams.context?.recipient) {
      reasons.push(`Great gift for your ${searchParams.context.recipient}`);
    }
    if (searchParams.context?.occasion === 'birthday') {
      reasons.push('Ideal birthday gift');
    }
    if (searchParams.context?.budgetPreference === 'low') {
      reasons.push('More affordable vs. your previous results');
    }
    if (searchParams.intent === 'gift_search') {
      reasons.push('Fits your gift search');
    }

    return reasons.length > 0
      ? reasons.join(' • ')
      : 'Recommended based on your query';
  }

  async generateResponse(query, agentResult, conversationTurns = []) {
    const { products, searchParams, toolsUsed, clarification } = agentResult;

    if (clarification) {
      return {
        response: clarification.question,
        results: [],
        followUp: clarification.options?.join(' | ') || null,
        clarification,
        context: {
          intent: searchParams.intent,
          refinements_available: false,
          toolsUsed
        }
      };
    }

    if (!products?.length) {
      return {
        response: `I couldn't find products matching "${query}". Could you share a budget or specific interests?`,
        results: [],
        followUp:
          'For example: chemistry kits, astronomy, or robotics — and a price range?',
        context: {
          intent: searchParams.intent,
          refinements_available: false,
          toolsUsed
        }
      };
    }

    return {
      response: this.buildResponseText(query, products, searchParams),
      results: products.slice(0, 5).map((r) => ({
        productId: r.id,
        name: r.name,
        price: r.price,
        rating: r.rating,
        reason: r.reason
      })),
      followUp: this.generateFollowUp(searchParams, conversationTurns.length),
      context: {
        intent: searchParams.intent,
        refinements_available: true,
        toolsUsed,
        recipient: searchParams.context?.recipient,
        age: searchParams.context?.age,
        interests: searchParams.tags,
        priceRange: searchParams.maxPrice
          ? [searchParams.minPrice || 0, searchParams.maxPrice]
          : searchParams.context?.priceRange
      }
    };
  }

  buildResponseText(query, results, searchParams) {
    if (searchParams.context?.refinement === 'price_lower') {
      return `Here are cheaper options (under ₹${searchParams.maxPrice}) from your previous science gift search:`;
    }
    if (searchParams.context?.occasion === 'birthday') {
      const agePart = searchParams.context.ageGroup
        ? `${searchParams.context.ageGroup} `
        : '';
      const recipient = searchParams.context.recipient || 'recipient';
      return `Here are great ${agePart}science gift options for your ${recipient}'s birthday:`;
    }
    if (searchParams.context?.budgetPreference === 'low') {
      return 'Here are more affordable options based on your previous search:';
    }
    if (searchParams.categories.length > 0) {
      return `Here are the best ${searchParams.categories.join(' & ')} picks for your request:`;
    }
    return 'Here are products that match what you asked for:';
  }

  generateFollowUp(searchParams, turnCount = 0) {
    const options = [
      'Would you like me to filter by budget, or focus on chemistry, astronomy, or robotics?',
      'Should I show cheaper alternatives or check reviews?',
      'Want similar products or delivery availability?'
    ];
    if (searchParams.context?.budgetPreference === 'low') {
      return 'Need even lower prices, or a specific science topic?';
    }
    return options[turnCount % options.length];
  }

  mergeContext(currentParams, conversationHistory) {
    if (!conversationHistory?.length) return currentParams;

    const lastAgentTurn = [...conversationHistory]
      .reverse()
      .find((t) => t.role === 'agent' && t.searchParams);

    if (!lastAgentTurn) return currentParams;

    return {
      ...lastAgentTurn.searchParams,
      ...currentParams,
      categories: currentParams.categories.length
        ? currentParams.categories
        : lastAgentTurn.searchParams.categories,
      tags: currentParams.tags.length
        ? currentParams.tags
        : lastAgentTurn.searchParams.tags,
      keywords: currentParams.keywords.length
        ? currentParams.keywords
        : lastAgentTurn.searchParams.keywords,
      context: {
        ...lastAgentTurn.searchParams.context,
        ...currentParams.context
      }
    };
  }
}

module.exports = new AgentService();
