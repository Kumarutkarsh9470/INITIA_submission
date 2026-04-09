// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GaussianMath.sol";

interface IMarketFactoryForAMM {
    function recordPosition(uint256 marketId, address user, uint256 outcomeIndex, uint256 collateralAmount) external;
    function getCreator(uint256 marketId) external view returns (address);
    function getResolutionType(uint256 marketId) external view returns (uint8);
    function claimScoreFor(uint256 marketId, address user) external;
    function outcomeSet(uint256 marketId) external view returns (bool);
    function winningOutcome(uint256 marketId) external view returns (uint8);
}

contract pmAMM is ERC1155, ReentrancyGuard {
    using SafeERC20 for IERC20;

    constructor() ERC1155("https://api.example.com/{id}.json") {}

    uint256 public constant WAD = 1e18;
    uint256 public constant PROTOCOL_FEE_BPS = 50;
    uint256 public constant LP_FEE_BPS = 30;

    address public factory;

    struct Market {
        uint reserveYes;
        uint reserveNo;
        uint liquidityParam;
        uint expiryBlock;
        uint256 totalBlocks;
        uint256 totalLPShares;
        bool settled;
        uint8 outcome;
        address collateralToken;
    }

    mapping(uint => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public lpShares;
    mapping(address => uint256) public protocolFees;

    function yesTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2;
    }

    function noTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2 + 1;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function effectiveL(uint256 marketId) public view returns (uint256) {
        Market storage m = markets[marketId];
        if (block.number >= m.expiryBlock) return 0;
        uint256 remaining = m.expiryBlock - block.number;
        uint256 ratio = (remaining * WAD) / m.totalBlocks;
        uint256 sqrtRatio = _sqrt(ratio * WAD);
        return (m.liquidityParam * sqrtRatio) / WAD;
    }

    function currentPrice(uint256 marketId) public view returns (uint256) {
        Market storage m = markets[marketId];
        uint256 L = effectiveL(marketId);
        if (L == 0) return 0;
        int256 diff = int256(m.reserveNo) - int256(m.reserveYes);
        int256 normalised = (diff * int256(WAD)) / int256(L);
        return GaussianMath.normalCDF(normalised);
    }

    function _costFunction(
        uint256 x,
        uint256 y,
        uint256 L
    ) internal pure returns (int256) {
        if (L == 0) return 0;
        int256 diff = int256(y) - int256(x);
        int256 norm = (diff * int256(WAD)) / int256(L);
        uint256 cdf = GaussianMath.normalCDF(norm);
        uint256 pdf = GaussianMath.normalPDF(norm);
        int256 term1 = (diff * int256(cdf)) / int256(WAD);
        int256 term2 = (int256(L) * int256(pdf)) / int256(WAD);
        int256 term3 = int256(y);
        return term1 + term2 - term3;
    }

    function _computeSharesOut(
        uint256 marketId,
        bool buyYes,
        uint256 netIn,
        uint256 /* L */
    ) internal view returns (uint256) {
        Market storage m = markets[marketId];
        uint256 resIn  = buyYes ? m.reserveNo  : m.reserveYes; // reserve that receives collateral
        uint256 resOut = buyYes ? m.reserveYes : m.reserveNo;  // reserve that gives shares
        require(resIn > 0, "pmAMM: empty reserve");

        // Constant-product: sharesOut = resOut * netIn / (resIn + netIn)
        // This naturally accounts for price impact and never drains the reserve
        return (resOut * netIn) / (resIn + netIn);
    }

    function initMarket(
        uint256 marketId,
        address collateral,
        uint256 expiryBlock,
        uint256 initialLiquidity,
        uint256 liquidityParam
    ) external {
        require(msg.sender == factory, "pmAMM: only factory");
        require(markets[marketId].collateralToken == address(0), "pmAMM: market exists");
        Market storage m = markets[marketId];
        m.collateralToken = collateral;
        m.expiryBlock = expiryBlock;
        m.totalBlocks = expiryBlock - block.number;
        m.liquidityParam = liquidityParam;
        m.reserveYes = initialLiquidity / 2;
        m.reserveNo = initialLiquidity / 2;
        m.totalLPShares = initialLiquidity;
        lpShares[marketId][msg.sender] = initialLiquidity;
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), initialLiquidity);
    }

    function buy(
        uint256 marketId,
        bool buyYes,
        uint256 collateralIn,
        uint256 minSharesOut
    ) external nonReentrant returns (uint256 sharesOut) {
        Market storage m = markets[marketId];
        require(block.number < m.expiryBlock, "pmAMM: market expired");
        require(!m.settled, "pmAMM: market settled");
        require(collateralIn > 0, "pmAMM: zero input");

        // Block creator from trading on Creator Resolve markets (anti-exploit)
        if (factory != address(0)) {
            IMarketFactoryForAMM f = IMarketFactoryForAMM(factory);
            // ResolutionType.CREATOR_RESOLVE == 2
            if (f.getResolutionType(marketId) == 2) {
                require(msg.sender != f.getCreator(marketId), "pmAMM: creator cannot trade on Creator Resolve markets");
            }
        }

        uint256 protocolFee = (collateralIn * PROTOCOL_FEE_BPS) / 10000;
        uint256 lpFee = (collateralIn * LP_FEE_BPS) / 10000;
        uint256 netIn = collateralIn - protocolFee - lpFee;
        protocolFees[m.collateralToken] += protocolFee;
        m.reserveYes += lpFee / 2;
        m.reserveNo += lpFee / 2;
        uint256 L = effectiveL(marketId);
        require(L > 0, "pmAMM: market at expiry");
        sharesOut = _computeSharesOut(marketId, buyYes, netIn, L);
        require(sharesOut >= minSharesOut, "pmAMM: slippage too high");
        require(sharesOut > 0, "pmAMM: zero shares out");
        if (buyYes) {
            require(m.reserveYes >= sharesOut, "pmAMM: insufficient YES reserve");
            m.reserveNo += netIn;
            m.reserveYes -= sharesOut;
        } else {
            require(m.reserveNo >= sharesOut, "pmAMM: insufficient NO reserve");
            m.reserveYes += netIn;
            m.reserveNo -= sharesOut;
        }
        IERC20(m.collateralToken).safeTransferFrom(msg.sender, address(this), collateralIn);
        uint256 tokenId = buyYes ? yesTokenId(marketId) : noTokenId(marketId);
        _mint(msg.sender, tokenId, sharesOut, "");

        // Record position for reputation tracking
        if (factory != address(0)) {
            uint256 outcomeIdx = buyYes ? 1 : 2;
            try IMarketFactoryForAMM(factory).recordPosition(marketId, msg.sender, outcomeIdx, collateralIn) {} catch {}
        }
    }

    function sell(
        uint256 marketId,
        bool sellYes,
        uint256 sharesIn,
        uint256 minCollateralOut
    ) external nonReentrant returns (uint256 collateralOut) {
        Market storage m = markets[marketId];
        require(block.number < m.expiryBlock, "pmAMM: market expired");
        require(!m.settled, "pmAMM: market settled");
        require(sharesIn > 0, "pmAMM: zero input");

        // Block creator from trading on Creator Resolve markets (anti-exploit)
        if (factory != address(0)) {
            IMarketFactoryForAMM f = IMarketFactoryForAMM(factory);
            if (f.getResolutionType(marketId) == 2) {
                require(msg.sender != f.getCreator(marketId), "pmAMM: creator cannot trade on Creator Resolve markets");
            }
        }

        // Constant-product: gross = resOpp * sharesIn / (resOwn + sharesIn)
        uint256 resOpp = sellYes ? m.reserveNo  : m.reserveYes; // reserve that pays collateral
        uint256 resOwn = sellYes ? m.reserveYes : m.reserveNo;  // reserve that receives shares
        uint256 gross = (resOpp * sharesIn) / (resOwn + sharesIn);

        uint256 protocolFee = (gross * PROTOCOL_FEE_BPS) / 10000;
        uint256 lpFee = (gross * LP_FEE_BPS) / 10000;
        collateralOut = gross - protocolFee - lpFee;
        require(collateralOut >= minCollateralOut, "pmAMM: slippage too high");
        protocolFees[m.collateralToken] += protocolFee;

        // Update reserves (constant-product preserves x*y=k minus fees)
        if (sellYes) {
            m.reserveYes += sharesIn;
            m.reserveNo -= gross;
        } else {
            m.reserveNo += sharesIn;
            m.reserveYes -= gross;
        }
        // Redistribute LP fee to both reserves (grows k over time)
        m.reserveYes += lpFee / 2;
        m.reserveNo += lpFee / 2;

        uint256 tokenId = sellYes ? yesTokenId(marketId) : noTokenId(marketId);
        _burn(msg.sender, tokenId, sharesIn);
        IERC20(m.collateralToken).safeTransfer(msg.sender, collateralOut);
    }

    function addLiquidity(
        uint256 marketId,
        uint256 amount
    ) external nonReentrant {
        Market storage m = markets[marketId];
        require(block.number < m.expiryBlock, "pmAMM: market expired");
        require(amount > 0, "pmAMM: zero amount");
        uint256 totalPool = m.reserveYes + m.reserveNo;
        uint256 newShares = totalPool == 0
            ? amount
            : (amount * m.totalLPShares) / totalPool;
        if (totalPool > 0) {
            m.reserveYes += (amount * m.reserveYes) / totalPool;
            m.reserveNo  += (amount * m.reserveNo)  / totalPool;
        } else {
            m.reserveYes += amount / 2;
            m.reserveNo  += amount / 2;
        }
        m.totalLPShares += newShares;
        lpShares[marketId][msg.sender] += newShares;
        IERC20(m.collateralToken).safeTransferFrom(msg.sender, address(this), amount);
    }

    function removeLiquidity(
        uint256 marketId,
        uint256 lpAmount
    ) external nonReentrant {
        Market storage m = markets[marketId];
        require(lpShares[marketId][msg.sender] >= lpAmount, "pmAMM: not enough LP shares");
        require(m.totalLPShares > 0, "pmAMM: no liquidity");
        uint256 yesOut = (lpAmount * m.reserveYes) / m.totalLPShares;
        uint256 noOut  = (lpAmount * m.reserveNo)  / m.totalLPShares;
        m.reserveYes -= yesOut;
        m.reserveNo  -= noOut;
        m.totalLPShares -= lpAmount;
        lpShares[marketId][msg.sender] -= lpAmount;
        _mint(msg.sender, yesTokenId(marketId), yesOut, "");
        _mint(msg.sender, noTokenId(marketId),  noOut,  "");
    }

    function settle(uint256 marketId, uint8 outcome) external {
        require(msg.sender == factory, "pmAMM: only factory");
        Market storage m = markets[marketId];
        require(!m.settled, "pmAMM: already settled");
        m.settled = true;
        m.outcome = outcome;
    }

    function redeem(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        require(m.settled, "pmAMM: not settled");
        uint256 tokenId = m.outcome == 1
            ? yesTokenId(marketId)
            : noTokenId(marketId);
        uint256 shares = balanceOf(msg.sender, tokenId);
        require(shares > 0, "pmAMM: nothing to redeem");
        _burn(msg.sender, tokenId, shares);
        IERC20(m.collateralToken).safeTransfer(msg.sender, shares);

        // Auto-claim reputation score on redeem
        if (factory != address(0)) {
            try IMarketFactoryForAMM(factory).claimScoreFor(marketId, msg.sender) {} catch {}
        }
    }

    function setFactory(address _factory) external {
        require(factory == address(0), "pmAMM: factory already set");
        factory = _factory;
    }

    function withdrawProtocolFees(address token, address to) external {
        require(msg.sender == factory, "pmAMM: only factory");
        uint256 amount = protocolFees[token];
        protocolFees[token] = 0;
        IERC20(token).safeTransfer(to, amount);
    }
}