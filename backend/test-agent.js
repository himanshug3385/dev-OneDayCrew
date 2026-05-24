/**
 * Test file to demonstrate the Agentic Search system
 * Run with: node test-agent.js
 */

const agentService = require('./services/agent');
const valkeyService = require('./services/valkey');

async function runTests() {
  try {
    console.log('🚀 Starting Agent Tests\n');
    
    // Initialize Valkey
    await valkeyService.connect();
    console.log('✅ Connected to Valkey\n');

    // Test 1: Parse natural language query
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Natural Language Query Parsing');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const testQueries = [
      "I need a birthday gift for my 10-year-old nephew who likes science",
      "Show me robotics kits under $50",
      "What's a good telescope for a beginner astronomer?",
      "Chemistry sets for kids, highly rated only"
    ];

    for (const query of testQueries) {
      console.log(`📝 Query: "${query}"`);
      const parsed = agentService.parseQuery(query);
      console.log(`📋 Parsed:`, JSON.stringify(parsed, null, 2));
      console.log();
    }

    // Test 2: Agent Reasoning
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Agent Multi-Step Reasoning');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const mainQuery = "I need a birthday gift for my 10-year-old nephew who likes science";
    console.log(`📝 Main Query: "${mainQuery}"`);
    
    const result = await agentService.reason(mainQuery);
    console.log(`\n🔧 Tools Used: ${result.toolsUsed.join(', ')}`);
    console.log(`🎯 Search Parameters:`, JSON.stringify(result.searchParams, null, 2));
    console.log(`\n📦 Results Found: ${result.results.length} products`);
    
    if (result.results.length > 0) {
      console.log('\nTop 3 Products:');
      result.results.slice(0, 3).forEach((product, i) => {
        console.log(`  ${i + 1}. ${product.name}`);
        console.log(`     💰 Price: ₹${product.price}`);
        console.log(`     ⭐ Rating: ${product.rating}/5`);
        console.log(`     ✨ Reason: ${product.reason}`);
      });
    }

    // Test 3: Generate Response
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Conversational Response Generation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const response = await agentService.generateResponse(
      mainQuery,
      result,
      []
    );

    console.log('💬 Agent Response:\n');
    console.log(response.response);
    console.log(`\n❓ Follow-up Question: ${response.followUp}`);
    console.log(`\n📊 Context:`, JSON.stringify(response.context, null, 2));

    // Test 4: Refinement Query
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Search Refinement');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const refinementQuery = "Show me cheaper options";
    console.log(`📝 Refinement Query: "${refinementQuery}"`);
    
    const refinedResult = await agentService.reason(
      refinementQuery,
      response.context
    );
    
    console.log(`\n🔧 Tools Used: ${refinedResult.toolsUsed.join(', ')}`);
    console.log(`💰 Price Range: ₹${refinedResult.searchParams.minPrice || 'any'} - ₹${refinedResult.searchParams.maxPrice || 'any'}`);
    console.log(`📦 Results Found: ${refinedResult.results.length} products`);

    if (refinedResult.results.length > 0) {
      console.log('\nCheaper Options:');
      refinedResult.results.slice(0, 3).forEach((product, i) => {
        console.log(`  ${i + 1}. ${product.name} - ₹${product.price}`);
      });
    }

    // Test 5: Conversation Memory
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 5: Conversation Memory & Context');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const { v7: uuidv7 } = require('uuid');
    const testSessionId = `sess_${uuidv7()}`;

    // Create conversation with multiple turns
    const conversation = {
      sessionId: testSessionId,
      userId: `user_${uuidv7()}`,
      turns: [
        {
          role: 'user',
          content: mainQuery,
          timestamp: new Date().toISOString()
        },
        {
          role: 'agent',
          content: response.response,
          searchParams: result.searchParams,
          timestamp: new Date().toISOString()
        },
        {
          role: 'user',
          content: refinementQuery,
          timestamp: new Date().toISOString()
        },
        {
          role: 'agent',
          content: 'Here are more affordable options...',
          searchParams: refinedResult.searchParams,
          timestamp: new Date().toISOString()
        }
      ],
      context: {
        intent: 'gift_search',
        refinements_available: true,
        lastSearchParams: refinedResult.searchParams
      },
      createdAt: new Date().toISOString()
    };

    await valkeyService.setConversation(testSessionId, conversation);
    console.log(`✅ Stored conversation: ${testSessionId}`);

    const retrievedConversation = await valkeyService.getConversation(testSessionId);
    console.log(`\n📊 Conversation Stats:`);
    console.log(`   • Session ID: ${retrievedConversation.sessionId}`);
    console.log(`   • User ID: ${retrievedConversation.userId}`);
    console.log(`   • Total Turns: ${retrievedConversation.turns.length}`);
    console.log(`   • Intent: ${retrievedConversation.context.intent}`);
    console.log(`   • Context: ${JSON.stringify(retrievedConversation.context, null, 2)}`);

    // Test 6: Tool Performance
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 6: Tool Performance');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.time('Search Tool');
    const searchResults = await agentService.searchProducts(result.searchParams);
    console.timeEnd('Search Tool');
    console.log(`   ✅ Found ${searchResults.length} products\n`);

    if (searchResults.length > 0) {
      console.time('Availability Tool');
      const availability = await agentService.checkAvailability(result.searchParams);
      console.timeEnd('Availability Tool');
      console.log(`   ✅ Checked ${availability.length} products\n`);

      console.time('Similar Products Tool');
      const similar = await agentService.findSimilarProducts(result.searchParams);
      console.timeEnd('Similar Products Tool');
      console.log(`   ✅ Found ${similar.length} similar products\n`);
    }

    console.log('\n✅ All tests completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await valkeyService.disconnect();
    process.exit(0);
  }
}

// Run tests
if (require.main === module) {
  runTests();
}

module.exports = { runTests };
