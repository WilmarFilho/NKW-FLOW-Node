const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Envia e-mail usando templates dinâmicos do SendGrid
 * @param {string} to - destinatário
 * @param {string} tipo - tipo do email (novo_cliente, falha_pagamento, cancelamento)
 * @param {object} templateData - dados dinâmicos para o template
 */
async function sendEmail(to, tipo, templateData = {}) {
  try {
    // Mapeia os tipos para os template IDs do SendGrid
    const templateIds = {
      novo_cliente: 'd-138b19761b914dceac588584a98397af',
      falha_pagamento: 'd-ce663d3ffe9941e294698c9064d8d195', 
      cancelamento: 'd-50e460749db142768b28eba694e9d178'   
    };

    const templateId = templateIds[tipo];
    if (!templateId) {
      throw new Error(`Tipo de email inválido: ${tipo}. Use: novo_cliente, falha_pagamento, cancelamento`);
    }

    const msg = {
      to,
      from: {
        email: process.env.SENDGRID_FROM,
        name: 'NKW FLOW'
      },
      templateId,
      dynamic_template_data: {
        ...templateData 
      }
    };

    await sgMail.send(msg);

  } catch (err) {
    console.error('❌ Erro ao enviar e-mail:', err.response?.body || err.message);
    throw err; 
  }
}

module.exports = { sendEmail };