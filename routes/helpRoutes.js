const express = require("express");
const axios = require("axios");
const router = express.Router();

router.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Mensagem ausente." });
  }

  try {
    // Chamada para workflow do N8N
    const response = await axios.post(
      "http://localhost:5678/webhook/help-chat",
      { message }
    );
    
    const reply = response.data.reply || "Desculpe, não consegui entender.";
    return res.json({ reply });
  } catch (error) {
    
    console.error("Erro ao processar mensagem:", error.message);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

module.exports = router;
