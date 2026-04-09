// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ForecasterReputation{
    address public factory;
    struct Forecaster{
        uint256 totalPredictions;
        uint256 correctPredictions;
        uint256 totalVolume;
        uint256 lastActiveBlock;
        uint256 score;
    }
    mapping(address=> Forecaster) public forecasters;
    mapping(uint256=>mapping(address=>uint256)) public positionOutcome;
    mapping(uint256 => mapping(address=>uint256)) public positionSize;

    event ScoreUpdated(address indexed user, uint256 newscore);
    event PositionRecorded(uint256 indexed marketId, address indexed user, uint256 outcomeIndex);

    function setFactory(address _factory) external{
        require(factory==address(0), "Rep: factory already set");
        factory= _factory;
    }

    function recordPosition(uint256 marketId, address user, uint256 outcomeIndex, uint256 collateralAmount) external {
        require(msg.sender==factory, "Rep: only factory");
        if(positionOutcome[marketId][user]==0){
            positionOutcome[marketId][user]=outcomeIndex;
        }
        positionSize[marketId][user]+=collateralAmount;
        Forecaster storage f= forecasters[user];
        f.totalVolume+= collateralAmount;
        f.lastActiveBlock= block.number;
        emit PositionRecorded(marketId,user,outcomeIndex);
    }

    function updateScore(uint256 marketId, uint8 winningOutcome, address user) external {
        require(msg.sender==factory, "Rep: only factory");
        Forecaster storage f= forecasters[user];
        if(positionSize[marketId][user]==0) return;
        if(positionSize[marketId][user]==type(uint256).max) return;
        f.totalPredictions++;
        if(positionOutcome[marketId][user]==uint256(winningOutcome)){
            f.correctPredictions++;
        }
        f.lastActiveBlock=block.number;
        positionSize[marketId][user]= type(uint256).max;

        // Compute and persist the updated score
        f.score = _computeScore(f);
        emit ScoreUpdated(user, f.score);
    }
    function _computeScore(Forecaster memory f) internal view returns (uint256) {
        if(f.totalPredictions==0) return 0;
        uint256 accuracy= (f.correctPredictions*400)/f.totalPredictions;
        uint256 calibration= (accuracy*300)/400;
        uint256 volumeTokens=f.totalVolume/1e18;
        uint256 volume= volumeTokens>0? _log2(volumeTokens)*10:0;
        if(volume>150)volume=150;
        uint256 blocksSince=block.number > f.lastActiveBlock? block.number-f.lastActiveBlock:0;
        uint256 consistency;
        // Initia MiniEVM: ~1 block/second
        // 8_640_000 blocks ≈ 100 days, 43_200_000 blocks ≈ 500 days
        if(blocksSince<8_640_000) consistency=150;
        else if(blocksSince<43_200_000) consistency=75;
        else consistency=0;
        return accuracy+calibration+volume+consistency;
    }
    function _log2(uint256 x) internal pure returns (uint256){
        if(x==0) return 0;
        uint256 n=0;
        while(x>1) {
            x>>=1;
            n++;
        }
        return n;
    }
    function getScore(address user) external view returns (uint256){
        return forecasters[user].score;
    }

    function isEligibleResolver(address user) external view returns (bool){
        return forecasters[user].score>=400;
    }

    function getLTV(address user) external view returns (uint256){
        return forecasters[user].score>=600? 60:50;
    }
    function bondWaived(address user) external view returns (bool){
        return forecasters[user].score>=800;
    }

}