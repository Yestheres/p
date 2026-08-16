# Ativar o editor do site

O site e o painel já estão prontos. Falta apenas ligar o backend seguro no Cloudflare.

## 1. Criar um token do GitHub

No GitHub, crie um **Fine-grained personal access token**.

Configure assim:

- **Resource owner:** `Yestheres`
- **Repository access:** `Only select repositories`
- Repositório: `p`
- **Repository permissions > Contents:** `Read and write`

Gere o token e copie-o. Não coloque esse token em nenhum arquivo do repositório.

## 2. Criar o Cloudflare Worker

No painel da Cloudflare, crie um Worker novo.

Abra o arquivo [`worker.js`](./worker.js), copie todo o código e use esse código no Worker. Depois publique/deploy.

## 3. Criar os Secrets do Worker

Nas configurações do Worker, adicione estes dois valores como **Secrets**:

- `GITHUB_TOKEN` = o token criado no passo 1
- `ADMIN_PASSWORD` = a senha que você quiser usar para editar o site

Não use Variables comuns para esses dois valores; use Secrets.

Se no futuro você colocar o site em um domínio próprio, adicione também:

- `ALLOWED_ORIGIN` = `https://seu-dominio.com`

## 4. Abrir o editor

Abra:

`https://yestheres.github.io/p/admin.html`

Na primeira vez, ele vai pedir:

- URL do Worker, por exemplo `https://nome-do-worker.seu-subdominio.workers.dev`
- sua senha do editor

A URL do Worker fica guardada no seu navegador. A senha fica apenas na sessão da aba.

## O que o editor já faz

- alterar o nome do site;
- alterar o título da aba;
- editar todos os textos;
- trocar a cor de fundo;
- adicionar imagens por arquivo;
- usar imagem por URL;
- alterar legendas;
- ordenar imagens;
- remover imagens da página;
- salvar diretamente no repositório `Yestheres/p`;
- atualizar o GitHub Pages automaticamente após o commit.

As imagens enviadas pelo painel são gravadas na pasta `images/` do repositório.
