import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkHealth,
  getConversation,
  searchAgent,
  sendFeedback
} from '../services/agentApi';
import '../styles/agent-search.scss';

const SESSION_KEY = 'agent_search_session';
const USER_KEY = 'agent_search_user';

const QUICK_PROMPTS = [
  'I need a birthday gift for my 10-year-old nephew who likes science',
  'Show me robotics kits under $50',
  "What's a good telescope for a beginner astronomer?",
  'Show me cheaper options',
  'Chemistry sets for kids, highly rated only'
];

function formatPrice(price) {
  if (price == null) return '—';
  return `₹${Number(price).toLocaleString('en-IN')}`;
}

const AgentSearchChat = () => {
  const [sessionId, setSessionId] = useState(
    () => sessionStorage.getItem(SESSION_KEY) || null
  );
  const [userId, setUserId] = useState(
    () => sessionStorage.getItem(USER_KEY) || null
  );
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [backendOnline, setBackendOnline] = useState(null);
  const [feedbackMap, setFeedbackMap] = useState({});
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    checkHealth()
      .then(() => setBackendOnline(true))
      .catch(() => setBackendOnline(false));
  }, []);

  const loadStoredSession = useCallback(async () => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;

    try {
      const conv = await getConversation(stored);
      const restored = [];
      for (const turn of conv.turns || []) {
        if (turn.role === 'user') {
          restored.push({ role: 'user', content: turn.content });
        } else if (turn.role === 'agent') {
          restored.push({
            role: 'agent',
            content: turn.content,
            results: (turn.results || []).map((id) => ({ productId: id })),
            followUp: null
          });
        }
      }
      if (restored.length) setMessages(restored);
      setSessionId(conv.sessionId);
      setUserId(conv.userId);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    loadStoredSession();
  }, [loadStoredSession]);

  const sendMessage = async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || loading) return;

    setError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');

    try {
      const data = await searchAgent({
        sessionId,
        userId,
        message: trimmed
      });

      setSessionId(data.sessionId);
      setUserId(data.userId);
      sessionStorage.setItem(SESSION_KEY, data.sessionId);
      sessionStorage.setItem(USER_KEY, data.userId);

      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content: data.response,
          results: data.results || [],
          followUp: data.followUp,
          context: data.context
        }
      ]);
    } catch (err) {
      setError(
        err.message ||
          'Could not reach the search agent. Is the backend running on port 3001?'
      );
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleFeedback = async (productId, feedback) => {
    if (!sessionId) return;
    setFeedbackMap((prev) => ({ ...prev, [productId]: feedback }));
    try {
      await sendFeedback({ sessionId, productId, feedback });
    } catch {
      /* ignore */
    }
  };

  const startNewChat = () => {
    setSessionId(null);
    setUserId(null);
    setMessages([]);
    setFeedbackMap({});
    setError(null);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
  };

  return (
    <div className='agent-search-layout'>
      <div className='agent-chat-panel'>
        <div className='agent-chat-header flex-between flex-wrap gap-12'>
          <div>
            <h5 className='mb-4 flex-align gap-8'>
              <i className='ph ph-sparkle text-main-600' />
              AI Shopping Assistant
            </h5>
            <p className='text-sm text-gray-600 mb-0'>
              Ask in plain English — I remember context across messages.
            </p>
          </div>
          <div className='flex-align gap-12'>
            <span className='text-sm text-gray-600 flex-align gap-6'>
              <span
                className={`agent-status-dot ${
                  backendOnline ? 'agent-status-dot--online' : 'agent-status-dot--offline'
                }`}
              />
              {backendOnline === null
                ? 'Checking…'
                : backendOnline
                  ? 'Agent online'
                  : 'Backend offline'}
            </span>
            <button
              type='button'
              className='btn btn-outline-secondary btn-sm rounded-pill'
              onClick={startNewChat}
            >
              New chat
            </button>
          </div>
        </div>

        <div className='agent-chat-messages'>
          {messages.length === 0 && !loading && (
            <div className='agent-chat-empty'>
              <i className='ph ph-chats-circle text-main-600 text-4xl mb-16 d-block' />
              <h6 className='mb-8'>Try a natural language search</h6>
              <p className='text-sm mb-0'>
                Example: &quot;Birthday gift for my 10-year-old nephew who likes
                science&quot;
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={`${msg.role}-${idx}`}
              className={`agent-message agent-message--${msg.role}`}
            >
              <div className='agent-message-bubble'>{msg.content}</div>

              {msg.role === 'agent' && msg.results?.length > 0 && (
                <div className='agent-product-grid'>
                  {msg.results.map((product) => (
                    <div
                      key={product.productId}
                      className='agent-product-card'
                    >
                      <div className='flex-between flex-wrap gap-8'>
                        <strong className='text-gray-900'>{product.name}</strong>
                        <span className='text-main-600 fw-semibold'>
                          {formatPrice(product.price)}
                        </span>
                      </div>
                      {product.rating != null && (
                        <div className='text-sm text-warning-600 mt-4'>
                          <i className='ph ph-star-fill' /> {product.rating}/5
                        </div>
                      )}
                      {product.reason && (
                        <p className='agent-product-reason mb-0'>
                          <i className='ph ph-lightbulb me-4' />
                          {product.reason}
                        </p>
                      )}
                      <div className='agent-feedback-btns'>
                        <button
                          type='button'
                          className={`agent-feedback-btn ${
                            feedbackMap[product.productId] === 'helpful'
                              ? 'agent-feedback-btn--active'
                              : ''
                          }`}
                          onClick={() =>
                            handleFeedback(product.productId, 'helpful')
                          }
                        >
                          <i className='ph ph-thumbs-up' /> Helpful
                        </button>
                        <button
                          type='button'
                          className={`agent-feedback-btn ${
                            feedbackMap[product.productId] === 'not_helpful'
                              ? 'agent-feedback-btn--active'
                              : ''
                          }`}
                          onClick={() =>
                            handleFeedback(product.productId, 'not_helpful')
                          }
                        >
                          <i className='ph ph-thumbs-down' /> Not helpful
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {msg.role === 'agent' && msg.followUp && (
                <p className='text-sm text-gray-600 mb-0 fst-italic'>
                  {msg.followUp}
                </p>
              )}
            </div>
          ))}

          {loading && (
            <div className='agent-message agent-message--agent'>
              <div className='agent-typing' aria-label='Agent is thinking'>
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className='agent-suggestions'>
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type='button'
              className='agent-suggestion-chip'
              disabled={loading}
              onClick={() => sendMessage(prompt)}
            >
              {prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt}
            </button>
          ))}
        </div>

        {error && (
          <div className='px-20 pb-8'>
            <div className='alert alert-danger py-8 px-16 mb-0 text-sm rounded-12'>
              <i className='ph ph-warning-circle me-4' />
              {error}
            </div>
          </div>
        )}

        <form className='agent-chat-input-bar' onSubmit={handleSubmit}>
          <div className='position-relative'>
            <input
              type='text'
              className='form-control py-16 px-24 rounded-pill pe-64'
              placeholder='Describe what you are looking for…'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              type='submit'
              className='w-48 h-48 bg-main-600 rounded-circle flex-center text-xl text-white position-absolute top-50 translate-middle-y inset-inline-end-0 me-8 border-0'
              disabled={loading || !input.trim()}
              aria-label='Send message'
            >
              <i className='ph ph-paper-plane-tilt' />
            </button>
          </div>
        </form>
      </div>

      <aside className='agent-sidebar'>
        <h6 className='mb-16'>How to use</h6>
        <ol className='text-sm text-gray-600 ps-20 mb-24'>
          <li className='mb-8'>Type or pick a sample question below the chat.</li>
          <li className='mb-8'>
            Refine with follow-ups like &quot;Show me cheaper options&quot;.
          </li>
          <li className='mb-8'>Rate results with thumbs up/down.</li>
          <li>Start a new chat anytime to reset context.</li>
        </ol>

        <h6 className='mb-12'>Requirements</h6>
        <ul className='text-sm text-gray-600 list-unstyled mb-24'>
          <li className='mb-8 flex-align gap-8'>
            <i className='ph ph-check-circle text-success-600' />
            Backend: <code>npm start</code> (port 3001)
          </li>
          <li className='mb-8 flex-align gap-8'>
            <i className='ph ph-check-circle text-success-600' />
            Valkey/Redis with JSON module
          </li>
          <li className='flex-align gap-8'>
            <i className='ph ph-check-circle text-success-600' />
            Frontend: <code>npm start</code> (port 3000)
          </li>
        </ul>

        {sessionId && (
          <div className='bg-neutral-50 rounded-12 p-16'>
            <p className='text-xs text-gray-500 mb-4'>Session ID</p>
            <p className='text-sm text-break mb-0 font-monospace'>{sessionId}</p>
          </div>
        )}
      </aside>
    </div>
  );
};

export default AgentSearchChat;
