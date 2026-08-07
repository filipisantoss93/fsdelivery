# Auditoria da navegação inferior — 07/08/2026

## Objetivo

Eliminar variações e conflitos da barra de navegação inferior entre as áreas operacionais do FS Delivery e manter um único componente responsável por montar, estilizar e controlar o menu mobile.

## Perfis atendidos

| Perfil | Páginas / contexto | Itens do menu |
|---|---|---|
| Plataforma principal | app, caixa, mesas, configurações, balcão e pagamentos | Início, Pedidos, Caixa, Mesas, Mais |
| Garçom | cardápio operacional | Mesas, Novo pedido, Pedidos |
| Cozinha | painel da cozinha | Local, On-line |
| Entregador | painel de entregas | Entregas, Rota, Atualizar |

## Falhas encontradas

### 1. Menu administrativo dependia de nomes com `.html`

O componente antigo comparava a rota atual com nomes como `app.html` e `caixa.html`. A aplicação já usa URLs limpas, então o componente podia ser carregado pelo bootstrap central e mesmo assim abortar internamente em `/app`, `/caixa`, `/mesas-operacao` ou `/configuracoes`.

### 2. Existiam múltiplas fontes de verdade

Algumas páginas continham `<nav class="mobile-nav">` diretamente no HTML, enquanto outras dependiam de JavaScript e outras não possuíam menu inferior. Isso permitia diferenças de markup, ícones, quantidade de itens, estado ativo e comportamento.

### 3. MutationObserver era usado para reconsolidar o menu administrativo

O componente antigo observava alterações no `body` por vários segundos e executava novamente a consolidação. Isso criava uma camada corretiva permanente para um elemento que deve ser determinístico e montado uma única vez.

### 4. Garçom possui navegação interna, não troca de página

O menu do garçom controla seções internas (`mesas`, `cardapio`, `pedidos`) e possui badge de pedidos prontos. A solução unificada preserva esse contrato sem depender da ordem de carregamento do `garcom.js`.

### 5. Cozinha e entregador precisam de ações próprias

A cozinha trabalha com escopos Local/On-line. O entregador precisa acessar rapidamente lista, rota e atualização. Esses menus não devem herdar os itens administrativos.

## Solução implementada

- criado `js/mobile-nav.js` como única fonte de comportamento;
- criado `css/mobile-nav.css` como única fonte de estilo do menu inferior;
- `js/supabase.js` passa a injetar o mesmo componente nas áreas operacionais;
- removidos `js/admin-mobile-nav.js` e `css/admin-mobile-nav.css`;
- URLs internas do componente usam rotas limpas, sem `.html`;
- qualquer `.mobile-nav` legado presente no HTML é removido e substituído pelo componente central;
- não é utilizado `MutationObserver` para reconstrução geral do menu;
- o único observer mantido é local e específico para sincronizar o badge de pedidos prontos do garçom;
- cada perfil possui configuração e ações próprias dentro do mesmo componente.

## Regras para manutenção

1. Não adicionar novos menus inferiores diretamente em páginas HTML.
2. Não criar CSS específico de barra inferior por página.
3. Novos perfis ou itens devem ser adicionados somente em `js/mobile-nav.js`.
4. Ajustes visuais globais devem ser feitos somente em `css/mobile-nav.css`.
5. Rotas internas devem permanecer sem extensão `.html`.
6. Menus de desktop/sidebar podem continuar específicos por área; esta auditoria consolida apenas a navegação inferior mobile.

## Critérios de regressão

- `/app` exibe o perfil principal e mantém item ativo coerente com hash/seção;
- `/caixa`, `/mesas-operacao`, `/configuracoes` e `/balcao` usam o mesmo menu principal;
- `/cardapio` autenticado como garçom mantém Mesas/Novo pedido/Pedidos e badge funcional;
- `/cozinha` alterna Local/On-line pelo menu inferior;
- `/entregador` aciona topo, rota e atualização pelos controles inferiores;
- nenhuma página operacional deve exibir dois menus inferiores;
- nenhuma navegação gerada pelo componente deve expor `.html`.
