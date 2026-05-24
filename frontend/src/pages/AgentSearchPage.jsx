import React from 'react';
import Preloader from '../helper/Preloader';
import HeaderTwo from '../components/HeaderTwo';
import Breadcrumb from '../components/Breadcrumb';
import AgentSearchChat from '../components/AgentSearchChat';
import ShippingTwo from '../components/ShippingTwo';
import FooterTwo from '../components/FooterTwo';
import ColorInit from '../helper/ColorInit';
import ScrollToTop from 'react-scroll-to-top';

const AgentSearchPage = () => {
  return (
    <>
      <ColorInit color={true} />
      <ScrollToTop smooth color='#FA6400' />
      <Preloader />
      <HeaderTwo category={true} />
      <Breadcrumb title='AI Search' />

      <section className='agent-search-section py-40'>
        <div className='container container-lg'>
          <AgentSearchChat />
        </div>
      </section>

      <ShippingTwo />
      <FooterTwo />
    </>
  );
};

export default AgentSearchPage;
