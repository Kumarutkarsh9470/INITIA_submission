// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IpmAMM {
    function initMarket(
        uint256 marketId,
        address collateral,
        uint256 expiryBlock,
        uint256 initialLiquidity,
        uint256 liquidityParam
    ) external;
    function settle(uint256 marketId, uint8 outcome) external;
    function currentPrice(uint256 marketId) external view returns (uint256);
    function claimScoreFor(uint256 marketId, address user) external;
}

interface IForecasterReputationFactory {
    function recordPosition(
        uint256 marketId,
        address user,
        uint256 outcomeIndex,
        uint256 collateralAmount
    ) external;
    function updateScore(uint256 marketId, uint8 winningOutcome, address user) external;
    function bondWaived(address user) external view returns (bool);
}

interface IResolutionCouncil {
    function openResolution(uint256 marketId) external;
}

interface IConnectOracle {
    struct Price {
        uint256 price;
        uint256 timestamp;
        uint64 height;
        uint64 nonce;
        uint64 decimal;
        uint64 id;
    }
    function get_price(string memory pair_id) external view returns (Price memory);
}

contract MarketFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ResolutionType { AUTO_ORACLE, SOCIAL_COUNCIL, CREATOR_RESOLVE }
    enum MarketState { OPEN, RESOLVING, SETTLED }
    enum Category { PRICE, EVENT, ECOSYSTEM }

    struct MarketMeta {
        string question;
        string[] outcomes;
        uint256 expiryBlock;
        address creator;
        ResolutionType resolutionType;
        Category category;
        MarketState state;
        string oraclePairId;
        uint256 oracleThreshold;
        uint256 creatorBond;
        uint256 creatorDeadline;
    }

    IpmAMM public amm;
    IForecasterReputationFactory public reputation;
    IResolutionCouncil public council;
    IConnectOracle public connectOracle;
    IERC20 public collateralToken;

    uint256 public nextMarketId;
    uint256 public constant CREATOR_BOND = 100 * 1e18;
    uint256 public constant MIN_LIQUIDITY = 50 * 1e18;
    uint256 public constant CREATOR_RESOLVE_WINDOW = 500; // ~5h at ~35s MiniEVM blocks

    mapping(uint256 => MarketMeta) public markets;
    mapping(uint256 => uint8) public winningOutcome;
    mapping(uint256 => bool) public outcomeSet;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        ResolutionType resType
    );
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event ResolutionTriggered(uint256 indexed marketId, ResolutionType resType);

    constructor(
        address _amm,
        address _reputation,
        address _council,
        address _collateral,
        address _connectOracle
    ) Ownable(msg.sender) {
        amm = IpmAMM(_amm);
        reputation = IForecasterReputationFactory(_reputation);
        council = IResolutionCouncil(_council);
        collateralToken = IERC20(_collateral);
        connectOracle = IConnectOracle(_connectOracle);
    }

    function createMarket(
        string calldata question,
        string[] calldata outcomes,
        uint256 expiryBlock,
        uint256 initialLiquidity,
        uint256 liquidityParam,
        ResolutionType resType,
        Category category,
        string calldata oraclePairId,
        uint256 oracleThreshold
    ) external nonReentrant returns (uint256 marketId) {
        // CHECKS
        require(expiryBlock > block.number + 10, "Factory: expiry too soon");
        require(initialLiquidity >= MIN_LIQUIDITY, "Factory: insufficient liquidity");
        require(outcomes.length >= 2 && outcomes.length <= 8, "Factory: bad outcomes");

        marketId = nextMarketId++;

        uint256 bond = reputation.bondWaived(msg.sender) ? 0 : CREATOR_BOND;

        // EFFECTS
        uint256 creatorDeadline = resType == ResolutionType.CREATOR_RESOLVE
            ? expiryBlock + CREATOR_RESOLVE_WINDOW
            : 0;

        MarketMeta storage m = markets[marketId];
        m.question = question;
        m.outcomes = outcomes;
        m.expiryBlock = expiryBlock;
        m.creator = msg.sender;
        m.resolutionType = resType;
        m.category = category;
        m.state = MarketState.OPEN;
        m.oraclePairId = oraclePairId;
        m.oracleThreshold = oracleThreshold;
        m.creatorBond = bond;
        m.creatorDeadline = creatorDeadline;

        // INTERACTIONS
        uint256 totalRequired = initialLiquidity + bond;
        collateralToken.safeTransferFrom(msg.sender, address(this), totalRequired);

        collateralToken.approve(address(amm), initialLiquidity);
        amm.initMarket(marketId, address(collateralToken), expiryBlock, initialLiquidity, liquidityParam);

        emit MarketCreated(marketId, msg.sender, question, resType);
    }

    function triggerResolution(uint256 marketId) external {
        MarketMeta storage m = markets[marketId];
        require(block.number >= m.expiryBlock, "Factory: not expired");
        require(m.state == MarketState.OPEN, "Factory: already resolving");

        m.state = MarketState.RESOLVING;

        if (m.resolutionType == ResolutionType.AUTO_ORACLE) {
            _resolveViaOracle(marketId);
        } else if (m.resolutionType == ResolutionType.SOCIAL_COUNCIL) {
            council.openResolution(marketId);
            emit ResolutionTriggered(marketId, m.resolutionType);
        } else {
            emit ResolutionTriggered(marketId, m.resolutionType);
        }
    }

    function _resolveViaOracle(uint256 marketId) internal {
        MarketMeta storage m = markets[marketId];
        IConnectOracle.Price memory p = connectOracle.get_price(m.oraclePairId);
        uint8 outcome = p.price >= m.oracleThreshold ? 1 : 2;
        _finalizeResolution(marketId, outcome);
    }

    function submitOutcome(uint256 marketId, uint8 outcome) external {
        MarketMeta storage m = markets[marketId];
        require(m.state == MarketState.RESOLVING, "Factory: not in resolving state");

        if (m.resolutionType == ResolutionType.CREATOR_RESOLVE) {
            require(msg.sender == m.creator, "Factory: only creator");
            require(block.number <= m.creatorDeadline, "Factory: creator deadline passed");
        } else if (m.resolutionType == ResolutionType.SOCIAL_COUNCIL) {
            require(msg.sender == address(council), "Factory: only council");
        } else {
            revert("Factory: auto-oracle markets resolve automatically");
        }

        _finalizeResolution(marketId, outcome);
    }

    /// @notice Escalate a CREATOR_RESOLVE market to Social Council if the creator missed the deadline.
    function escalateCreatorResolve(uint256 marketId) external {
        MarketMeta storage m = markets[marketId];
        require(m.state == MarketState.RESOLVING, "Factory: not resolving");
        require(m.resolutionType == ResolutionType.CREATOR_RESOLVE, "Factory: not creator-resolve");
        require(block.number > m.creatorDeadline, "Factory: creator still has time");

        // Forfeit the creator bond (stays in contract as protocol revenue)
        m.creatorBond = 0;

        // Escalate to council
        council.openResolution(marketId);
        emit ResolutionTriggered(marketId, ResolutionType.SOCIAL_COUNCIL);
    }

    function finalizeResolution(uint256 marketId, uint8 outcome) external {
        require(msg.sender == address(council), "Factory: only council");
        MarketMeta storage m = markets[marketId];
        require(m.state == MarketState.RESOLVING, "Factory: not resolving");
        _finalizeResolution(marketId, outcome);
    }

    function _finalizeResolution(uint256 marketId, uint8 outcome) internal {
        MarketMeta storage m = markets[marketId];
        m.state = MarketState.SETTLED;
        winningOutcome[marketId] = outcome;
        outcomeSet[marketId] = true;
        amm.settle(marketId, outcome);

        if (m.creatorBond > 0) {
            collateralToken.safeTransfer(m.creator, m.creatorBond);
            m.creatorBond = 0;
        }

        emit MarketResolved(marketId, outcome);
    }

    function recordPosition(
        uint256 marketId,
        address user,
        uint256 outcomeIndex,
        uint256 collateralAmount
    ) external {
        require(msg.sender == address(amm), "Factory: only AMM");
        reputation.recordPosition(marketId, user, outcomeIndex, collateralAmount);
    }

    /// @notice Returns creator address for a market (used by AMM to block creator trading)
    function getCreator(uint256 marketId) external view returns (address) {
        return markets[marketId].creator;
    }

    /// @notice Returns resolution type for a market
    function getResolutionType(uint256 marketId) external view returns (ResolutionType) {
        return markets[marketId].resolutionType;
    }

    // ── View helpers (outcomes array not exposed by auto-getter) ──

    function getOutcomes(uint256 marketId) external view returns (string[] memory) {
        return markets[marketId].outcomes;
    }

    function getMarket(uint256 marketId) external view returns (
        string memory question,
        string[] memory outcomes,
        uint256 expiryBlock,
        address creator,
        ResolutionType resolutionType,
        Category category,
        MarketState state,
        string memory oraclePairId,
        uint256 oracleThreshold,
        uint256 creatorBond,
        uint256 creatorDeadline
    ) {
        MarketMeta storage m = markets[marketId];
        return (
            m.question,
            m.outcomes,
            m.expiryBlock,
            m.creator,
            m.resolutionType,
            m.category,
            m.state,
            m.oraclePairId,
            m.oracleThreshold,
            m.creatorBond,
            m.creatorDeadline
        );
    }

    /// @notice Users call this after a market is settled to update their reputation score.
    function claimScore(uint256 marketId) external {
        require(outcomeSet[marketId], "Factory: market not settled");
        reputation.updateScore(marketId, winningOutcome[marketId], msg.sender);
    }

    /// @notice Called by AMM during redeem to auto-update reputation for the redeemer.
    function claimScoreFor(uint256 marketId, address user) external {
        require(msg.sender == address(amm), "Factory: only AMM");
        require(outcomeSet[marketId], "Factory: market not settled");
        reputation.updateScore(marketId, winningOutcome[marketId], user);
    }
}
