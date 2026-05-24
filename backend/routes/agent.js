const express = require('express');
const { v7: uuidv7 } = require('uuid');
const crypto = require('crypto');
const router = express.Router();

const valkeyService = require('../services/valkey');
const agentService = require('../services/agent');

/**
 * POST /api/agent/search
 * Send natural language query to agent
 */
router.post('/search', async (req, res) => {
  try {
    const { sessionId, userId, message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Generate or use provided session ID
    const currentSessionId = sessionId || `sess_${uuidv7()}`;
    const currentUserId = userId || `user_${uuidv7()}`;

    console.log(`\n🔍 New search query from ${currentSessionId}`);
    console.log(`📝 Query: "${message}"`);

    // Get or create conversation
    let conversation = await valkeyService.getConversation(currentSessionId);

    if (!conversation) {
      conversation = {
        sessionId: currentSessionId,
        userId: currentUserId,
        turns: [],
        context: {
          intent: null,
          refinements_available: false
        },
        createdAt: new Date().toISOString()
      };
    }

    // Add user message to conversation
    const userTurn = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    conversation.turns.push(userTurn);

    // Extract conversation history for context
    const conversationHistory = conversation.turns.map(t => ({
      role: t.role,
      content: t.content,
      searchParams: t.searchParams
    }));

    // Run agent reasoning
    const agentResult = await agentService.reason(
      message,
      conversation.context
    );

    // Generate conversational response
    const response = await agentService.generateResponse(
      message,
      agentResult,
      conversationHistory
    );

    // Add agent response to conversation
    const agentTurn = {
      role: 'agent',
      content: response.response,
      searchParams: agentResult.searchParams,
      results: response.results.map(r => r.productId),
      timestamp: new Date().toISOString(),
      toolsUsed: agentResult.toolsUsed
    };
    conversation.turns.push(agentTurn);

    // Update context
    conversation.context = {
      ...conversation.context,
      ...response.context,
      lastSearchParams: agentResult.searchParams
    };

    // Save conversation
    await valkeyService.setConversation(currentSessionId, conversation);

    // Cache this agent result
    const queryHash = crypto
      .createHash('md5')
      .update(JSON.stringify(agentResult.searchParams))
      .digest('hex');
    await valkeyService.setCacheResult(queryHash, response, 600);

    console.log(`✅ Agent response generated with ${response.results.length} products`);

    return res.json({
      sessionId: currentSessionId,
      userId: currentUserId,
      response: response.response,
      results: response.results,
      followUp: response.followUp,
      context: response.context,
      turnCount: conversation.turns.length
    });

  } catch (error) {
    console.error('Error in agent search:', error);
    res.status(500).json({ 
      error: 'Failed to process search query',
      message: error.message 
    });
  }
});

/**
 * GET /api/agent/conversation/:sessionId
 * Get conversation history
 */
router.get('/conversation/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const conversation = await valkeyService.getConversation(sessionId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Return full conversation with metadata
    return res.json({
      sessionId: conversation.sessionId,
      userId: conversation.userId,
      turns: conversation.turns,
      context: conversation.context,
      createdAt: conversation.createdAt,
      turnCount: conversation.turns.length
    });

  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve conversation',
      message: error.message 
    });
  }
});

/**
 * POST /api/agent/feedback
 * User feedback on results (thumbs up/down)
 */
router.post('/feedback', async (req, res) => {
  try {
    const { sessionId, productId, feedback, reason } = req.body;

    if (!sessionId || !productId || !feedback) {
      return res.status(400).json({ 
        error: 'sessionId, productId, and feedback are required' 
      });
    }

    // Store feedback
    const feedbackKey = `feedback:${sessionId}:${productId}`;
    const feedbackData = {
      sessionId,
      productId,
      feedback, // 'helpful', 'not_helpful', 'purchased'
      reason: reason || null,
      timestamp: new Date().toISOString()
    };

    await valkeyService.client.json.set(
      feedbackKey,
      '$',
      feedbackData
    );
    await valkeyService.client.expire(feedbackKey, 2592000); // 30 days

    console.log(`📊 Feedback recorded: ${productId} - ${feedback}`);

    return res.json({
      success: true,
      message: 'Feedback recorded',
      feedback: feedbackData
    });

  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({ 
      error: 'Failed to record feedback',
      message: error.message 
    });
  }
});

/**
 * POST /api/agent/refine
 * Refine previous search with new criteria
 */
router.post('/refine', async (req, res) => {
  try {
    const { sessionId, refinement } = req.body;

    if (!sessionId || !refinement) {
      return res.status(400).json({ 
        error: 'sessionId and refinement are required' 
      });
    }

    // Get existing conversation
    const conversation = await valkeyService.getConversation(sessionId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Process refinement as a new search
    const response = await router.stack
      .find(layer => layer.route && layer.route.path === '/search')
      .route.stack[0]
      .handle(
        { body: { sessionId, message: refinement } },
        res
      );

  } catch (error) {
    console.error('Error refining search:', error);
    res.status(500).json({ 
      error: 'Failed to refine search',
      message: error.message 
    });
  }
});

/**
 * GET /api/agent/debug/:sessionId
 * Debug endpoint to see agent reasoning
 */
router.get('/debug/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const conversation = await valkeyService.getConversation(sessionId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Return detailed reasoning data
    const debugInfo = {
      sessionId: conversation.sessionId,
      turns: conversation.turns.map(turn => ({
        role: turn.role,
        content: turn.content,
        ...(turn.searchParams && { 
          parsedParams: turn.searchParams,
          toolsUsed: turn.toolsUsed
        }),
        timestamp: turn.timestamp
      })),
      context: conversation.context,
      stats: {
        totalTurns: conversation.turns.length,
        userTurns: conversation.turns.filter(t => t.role === 'user').length,
        agentTurns: conversation.turns.filter(t => t.role === 'agent').length
      }
    };

    return res.json(debugInfo);

  } catch (error) {
    console.error('Error getting debug info:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve debug info',
      message: error.message 
    });
  }
});

module.exports = router;
