// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IForcasterReputation {
    function isEligibleResolver(address user) external view returns (bool);
    function getScore(address user) external view returns (uint256);
}

interface IMarketFactory {
    function finalizeResolution(uint256 marketID,uint8 outcome) external;
}

contract ResolutionCouncil is ReentrancyGuard {
    using SafeERC20 for IERC20;

    //state variables

    IForcasterReputation public reputation;
    address public factory;
    IERC20 public bondToken;//collateral tokens used for bonds

uint256 public constant RESOLVER_BOND = 20*1e18;  //20 tokens to register
uint256 public constant RESOLUTION_PERIOD = 500;   // ~5 hours at ~35 sec/block on MiniEVM
uint256 public constant SUPERMAJORITY_BPS = 6700;  // 67% of the votes cast to resolve
    

    struct Resolution{
        bool open;
        uint256 deadline;//block number when voting closes 
        uint256 totalWeight;   //sum of all resolver scores
        uint256[8] weightPerOutcome;//total weight per outcome index
        bool finalized;
        uint8 result;// winning outcome index
    }

mapping(uint256 => Resolution) public resolutions;

mapping(uint256 => mapping(address => uint256)) public resolverBonds;

mapping(uint256 => mapping(address=>uint8)) public resolverVotes;


//EVENTS

event ResolutionOpened(uint256 indexed marketID,uint256 deadline);
event ResolverRegistered(uint256 indexed marketID, address indexed resolver);
event OutcomeVoted(uint256 indexed marketID, address indexed resolver,uint outcome);
event ResolutionFinalized(uint256 indexed marketID, uint8 winningOutcome);

//CONSTRUCTOR

constructor(address _reputation , address _bondToken){
    reputation = IForcasterReputation(_reputation);
    bondToken = IERC20(_bondToken);
}

//CORE FUNCTIONS

function setFactory(address _factory) external {
   require(factory == address(0), "Council: factory already set");
   factory = _factory;
}

function openResolution(uint256 marketID) external{
    require(msg.sender == factory, "Council: only factory");
        Resolution storage r = resolutions[marketID];
        require(!r.open, "Council: already open");

        r.open     = true;
        r.deadline = block.number + RESOLUTION_PERIOD;

        emit ResolutionOpened(marketID, r.deadline);
}


function registerAsResolver(uint256 marketId) external {
        require(reputation.isEligibleResolver(msg.sender), "Council: score too low");

        Resolution storage r = resolutions[marketId];
        require(r.open && !r.finalized,                    "Council: not open");
        require(block.number <= r.deadline,                "Council: deadline passed");
        require(resolverBonds[marketId][msg.sender] == 0,  "Council: already registered");

        bondToken.safeTransferFrom(msg.sender, address(this), RESOLVER_BOND);
        resolverBonds[marketId][msg.sender] = RESOLVER_BOND;

        emit ResolverRegistered(marketId, msg.sender);
    }


function submitVote(uint256 marketId, uint8 outcomeIndex) external {
        Resolution storage r = resolutions[marketId];
        require(r.open && !r.finalized,                       "Council: not open");
        require(block.number <= r.deadline,                   "Council: deadline passed");
        require(resolverBonds[marketId][msg.sender] > 0,      "Council: not registered");
        require(resolverVotes[marketId][msg.sender] == 0,     "Council: already voted");
        require(outcomeIndex < 8,                             "Council: invalid outcome");

        uint256 weight = reputation.getScore(msg.sender);
        require(weight > 0, "Council: zero score");

        // Store as outcomeIndex + 1 so that 0 always means "not voted"
        resolverVotes[marketId][msg.sender] = outcomeIndex + 1;
        r.weightPerOutcome[outcomeIndex]   += weight;
        r.totalWeight                      += weight;

        emit OutcomeVoted(marketId, msg.sender, outcomeIndex);
}


function finalizeResolution(uint256 marketId) external {
        Resolution storage r = resolutions[marketId];
        require(r.open && !r.finalized, "Council: not open or already final");

        bool deadlinePassed = block.number > r.deadline;
        bool hasMajority    = _checkSupermajority(r);
        require(deadlinePassed || hasMajority, "Council: voting still active");

        uint8 winner = _findWinner(r);

        if (!hasMajority) {
            // Deadline passed without supermajority — use simple plurality
            require(r.totalWeight > 0, "Council: no votes cast");
        }

        r.finalized = true;
        r.result    = winner;

        // Tell the factory to settle the market with this outcome
        // AMM uses 1-based outcomes (1=first outcome, 2=second, etc.)
        // Council uses 0-based indices, so add 1 for factory/AMM compatibility
        IMarketFactory(factory).finalizeResolution(marketId, winner + 1);

        emit ResolutionFinalized(marketId, winner);
    }

function claimBond(uint256 marketId) external nonReentrant {
        Resolution storage r = resolutions[marketId];
        require(r.finalized,                              "Council: not finalized");
        require(resolverBonds[marketId][msg.sender] > 0,  "Council: no bond to claim");

        uint8 myVote = resolverVotes[marketId][msg.sender];
        require(myVote > 0, "Council: did not vote");

        uint8    myOutcome = myVote - 1; // remove the +1 offset added during submitVote
        uint256  bond      = resolverBonds[marketId][msg.sender];

        // CEI: clear bond before transfer
        resolverBonds[marketId][msg.sender] = 0;

if (myOutcome == r.result) {
            // Honest voter: full bond + bonus (capped to contract balance)
            uint256 bonus = (bond * 500) / 10000;
            uint256 contractBal = bondToken.balanceOf(address(this));
            uint256 payout = bond + bonus;
            if (payout > contractBal) payout = contractBal;
            bondToken.safeTransfer(msg.sender, payout);
        }
        // Dishonest voter: bond is forfeited (stays in contract)
    }
        

        //internal helpers

        function _findWinner(Resolution storage r) internal view returns (uint8) {
        uint8   best  = 0;
        uint256 bestW = 0;
        for (uint8 i = 0; i < 8; i++) {
            if (r.weightPerOutcome[i] > bestW) {
                bestW = r.weightPerOutcome[i];
                best  = i;
            }
        }
        return best;
    }
function _checkSupermajority(Resolution storage r) internal view returns (bool) {
        if (r.totalWeight == 0) return false;
        uint8 winner = _findWinner(r);
        return r.weightPerOutcome[winner] * 10000 >= r.totalWeight * SUPERMAJORITY_BPS;
    }

    // ── View helper (auto-getter skips fixed arrays) ──

    function getResolution(uint256 marketId) external view returns (
        bool open,
        uint256 deadline,
        uint256 totalWeight,
        uint256[8] memory weightPerOutcome,
        bool finalized,
        uint8 result
    ) {
        Resolution storage r = resolutions[marketId];
        return (r.open, r.deadline, r.totalWeight, r.weightPerOutcome, r.finalized, r.result);
    }

    }