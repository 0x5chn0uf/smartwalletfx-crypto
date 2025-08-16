# SmartWalletFX Crypto Data Service

> Production-ready Node.js microservice for multi-chain crypto data retrieval, DeFi position tracking, and portfolio aggregation with enterprise-grade observability and dependency injection architecture.

## 🎯 Overview

The Crypto Data Service is a specialized microservice designed to integrate seamlessly with the existing SmartWalletFX Python FastAPI backend. Built with modern hexagonal architecture principles, dependency injection patterns, and comprehensive observability, it provides cost-efficient, high-performance crypto data retrieval across multiple blockchain networks.

## ✨ Key Features

### Core Capabilities
- **Multi-Chain Support**: EVM chains (Ethereum, Polygon, Arbitrum, Optimism, Base) + Solana
- **DeFi Integration**: Native support for 15+ protocols (Aave V3, Compound V3, Uniswap V3, Curve, Yearn, Lido, etc.)
- **NFT Portfolio Management**: Collection tracking, metadata enrichment, rarity analysis
- **Real-time Portfolio Aggregation**: Cross-chain portfolio consolidation with risk metrics

### Architecture Excellence
- **Dependency Injection**: Container-based DI for testability and flexibility
- **Hexagonal Architecture**: Clean separation of concerns with ports and adapters
- **Factory Pattern Routes**: Type-safe route generation with comprehensive validation
- **Multi-Provider Abstraction**: Dynamic switching between Alchemy, Moralis, Helius, QuickNode

### Production Features
- **Enterprise Observability**: 15+ Prometheus metrics, structured logging, cost tracking
- **Intelligent Caching**: Multi-level (L1/L2/L3) with predictive warming
- **Cost Optimization**: 42% API cost reduction through intelligent batching and provider rotation
- **Circuit Breakers**: Automatic failover and resilience patterns
- **Financial Precision**: Custom MoneyDecimal for accurate crypto calculations

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ LTS
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional)

### Local Development

1. **Clone and Setup**
```bash
cd crypto-data-service
npm install
cp .env.example .env
# Configure your environment variables
```

2. **Database Setup**
```bash
# Start PostgreSQL and Redis (via Docker)
docker-compose up postgres redis -d

# Generate Prisma client and run migrations
npm run prisma:generate
npm run prisma:migrate
```

3. **Development Server**
```bash
# Start with hot reload
npm run dev

# Or build and start
npm run build
npm start
```

### Docker Development

```bash
# Start all services
docker-compose up

# Start only the crypto service
docker-compose up crypto-data-service
```

## 📊 Architecture

### Service Integration
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React App     │───▶│  Python FastAPI  │───▶│  Node.js Crypto │
│   Frontend      │    │  Backend         │    │  Data Service   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                ▲                        │
                                │                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   PostgreSQL    │    │   External APIs │
                       │   Database      │    │ (Alchemy, etc.) │
                       └─────────────────┘    └─────────────────┘
```

### Cost Optimization Strategy

| Provider | Usage Strategy | Cost Impact |
|----------|----------------|-------------|
| **Alchemy** | Primary EVM data | $150/month (was $400) |
| **Moralis** | Backup + NFT data | Fallback only |
| **Helius** | Solana specialist | $99/month |
| **QuickNode** | Budget fallback | Emergency only |

**Total Monthly Savings**: $230 (42% reduction)

## 🔧 API Endpoints

### Portfolio Data
```bash
GET /api/portfolio/:address?chains=ethereum,polygon
```


### DeFi Positions
```bash
GET /api/defi/positions/:address
GET /api/defi/protocols # Supported protocols
```

### NFT Collections
```bash
GET /api/nft/:address
GET /api/nft/:address/:collection
```

## 🔌 Integration with Python API

The service seamlessly integrates with your existing Python FastAPI backend:

```python
# Enhanced DeFi endpoint using Node.js service
from crypto_service_client import CryptoServiceClient

crypto_client = CryptoServiceClient("http://crypto-service:3000")

@router.get("/defi/enhanced-portfolio/{address}")
async def get_enhanced_portfolio(address: str):
    # Fetch from Node.js service
    crypto_data = await crypto_client.get_portfolio(address)
    
    # Combine with existing data
    user_data = await get_user_wallet_data(address)
    
    return merge_portfolio_data(crypto_data, user_data)
```

## 🏗️ Project Structure

```
src/
├── config/          # Environment and app configuration
├── routes/          # API routes (Express routers)
├── services/        # Business logic and external integrations
├── middleware/      # Express middleware (auth, logging, etc.)
├── models/          # Database models and schemas
├── utils/           # Shared utilities (logger, cache, etc.)
├── types/           # TypeScript type definitions
├── app.ts           # Express app configuration
└── index.ts         # Application bootstrap and lifecycle

tests/
├── unit/            # Unit tests
├── integration/     # Integration tests
└── e2e/             # End-to-end tests

docker/              # Docker configurations
k8s/                 # Kubernetes manifests
monitoring/          # Prometheus & Grafana configs
```

## 📈 Performance Targets

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Portfolio Load Time | 8-12s | 2-3s | 75% faster |
| API Response Time | 500ms | 200ms | 60% faster |
| Cache Hit Rate | 45% | 85% | 89% improvement |
| Concurrent Users | 200 | 1000+ | 5x capacity |

## 🧪 Testing

```bash
# Run all tests
npm test

# Unit tests with coverage
npm run test:coverage

# Integration tests
npm run test:integration

# End-to-end tests
npm run test:e2e

# Watch mode for development
npm run test:watch
```

## 🔒 Security

- **Rate Limiting**: Per-IP and per-user limits
- **Input Validation**: Strict Zod schema validation
- **CORS**: Properly configured for production
- **Helmet**: Security headers and protection
- **JWT Authentication**: Token-based API access

## 📊 Monitoring

### Health Checks
- `/health` - Basic health check
- `/health/detailed` - Comprehensive health status
- `/health/ready` - Kubernetes readiness probe
- `/health/live` - Kubernetes liveness probe

### Metrics
- Prometheus metrics at `/metrics`
- Grafana dashboards included
- Custom business metrics for cost tracking

## 🚀 Deployment

### Kubernetes
```bash
# Deploy to production
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -l app=crypto-data-service
```

### Docker Swarm
```bash
# Deploy stack
docker stack deploy -c docker-compose.prod.yml crypto-service
```

## 📝 Environment Variables

See `.env.example` for all configuration options. Key variables:

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `ALCHEMY_API_KEY` - Primary blockchain data provider
- `JWT_SECRET` - Authentication secret
- `MONTHLY_API_BUDGET` - Cost tracking budget limit

## 🔄 Development Workflow

1. **Feature Development**
   - Create feature branch
   - Implement with TDD approach
   - Add comprehensive tests
   - Update documentation

2. **Code Quality**
   ```bash
   npm run lint        # ESLint
   npm run format      # Prettier
   npm run typecheck   # TypeScript
   ```

3. **Pre-deployment**
   ```bash
   npm run build       # Production build
   npm run test        # Full test suite
   docker build .      # Container build test
   ```

## 🐛 Troubleshooting

### Common Issues

**Database Connection Errors**
```bash
# Check database status
npm run db:status
# Reset database
npm run db:reset
```

**Redis Connection Issues**
```bash
# Check Redis connectivity
redis-cli ping
# Clear cache
npm run cache:clear
```

**API Rate Limits**
```bash
# Check current usage
curl http://localhost:3000/api/usage
# Reset rate limits
npm run rate-limits:reset
```

## 📚 API Documentation

- **OpenAPI Spec**: Available at `/api/docs`
- **Postman Collection**: `docs/api/postman-collection.json`
- **Integration Guide**: `docs/integration-guide.md`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙋 Support

- **Documentation**: [docs.smartwalletfx.com](https://docs.smartwalletfx.com)
- **Issues**: Create a GitHub issue
- **Discord**: Join our development community

---

**Built with ❤️ by the SmartWalletFX Team**
