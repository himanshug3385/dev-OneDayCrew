import React, { useCallback, useEffect, useState } from 'react';
import AgentSearchChat from './AgentSearchChat';
import { OPEN_AGENT_ASSISTANT } from '../utils/openAgentAssistant';
import '../styles/agent-assistant.scss';

const OPEN_KEY = 'agent_assistant_open';
const EXPANDED_KEY = 'agent_assistant_expanded';

/**
 * Global floating AI assistant — visible on every page.
 * States: closed (FAB) → open (compact panel) → expanded (large overlay).
 */
const AgentAssistant = () => {
  const [isOpen, setIsOpen] = useState(
    () => sessionStorage.getItem(OPEN_KEY) === '1'
  );
  const [isExpanded, setIsExpanded] = useState(
    () => sessionStorage.getItem(EXPANDED_KEY) === '1'
  );
  const openPanel = useCallback(() => {
    setIsOpen(true);
    sessionStorage.setItem(OPEN_KEY, '1');
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setIsExpanded(false);
    sessionStorage.setItem(OPEN_KEY, '0');
    sessionStorage.setItem(EXPANDED_KEY, '0');
  }, []);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      sessionStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  useEffect(() => {
    if (isExpanded) {
      document.body.classList.add('agent-assistant-expanded');
    } else {
      document.body.classList.remove('agent-assistant-expanded');
    }
    return () => document.body.classList.remove('agent-assistant-expanded');
  }, [isExpanded]);

  useEffect(() => {
    const onOpen = () => openPanel();
    window.addEventListener(OPEN_AGENT_ASSISTANT, onOpen);
    return () => window.removeEventListener(OPEN_AGENT_ASSISTANT, onOpen);
  }, [openPanel]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        if (isExpanded) {
          setIsExpanded(false);
          sessionStorage.setItem(EXPANDED_KEY, '0');
        } else {
          closePanel();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isExpanded, closePanel]);

  const handleFabClick = () => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  };

  return (
    <>
      <div
        className={`agent-assistant-backdrop ${
          isOpen && isExpanded ? 'agent-assistant-backdrop--visible' : ''
        }`}
        onClick={() => {
          setIsExpanded(false);
          sessionStorage.setItem(EXPANDED_KEY, '0');
        }}
        aria-hidden={!isExpanded}
      />

      <div
        className={`agent-assistant-root ${
          isOpen
            ? isExpanded
              ? 'agent-assistant-root--expanded'
              : 'agent-assistant-root--open'
            : ''
        }`}
        role='dialog'
        aria-label='AI shopping assistant'
        aria-hidden={!isOpen}
      >
        {isOpen && (
          <AgentSearchChat
            isExpanded={isExpanded}
            onClose={closePanel}
            onToggleExpand={toggleExpand}
          />
        )}
      </div>

      <button
        type='button'
        className={`agent-assistant-fab ${
          isOpen && !isExpanded ? 'agent-assistant-fab--hidden' : ''
        } ${isExpanded ? 'agent-assistant-fab--expanded-close' : ''}`}
        onClick={handleFabClick}
        aria-label={
          isOpen ? 'Close shopping assistant' : 'Open shopping assistant'
        }
        title='AI Shopping Assistant'
      >
        <i className={isOpen ? 'ph ph-x' : 'ph ph-sparkle'} />
      </button>
    </>
  );
};

export default AgentAssistant;
