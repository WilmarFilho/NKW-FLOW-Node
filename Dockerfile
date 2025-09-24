# Usa imagem oficial do Node.js
FROM node:18

# Define diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala dependências
RUN npm install

# Copia o restante da aplicação
COPY . .

# Expõe a porta (ajuste conforme necessário no seu app)
EXPOSE 3000

# Comando padrão para iniciar o servidor
CMD ["npm", "start"]
