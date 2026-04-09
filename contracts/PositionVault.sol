// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IpmAMM{
    function currentPrice(uint256 marketId) external view returns (uint256);
    function yesTokenId(uint256 marketId) external pure returns (uint256);
    function noTokenId(uint256 marketId) external pure returns (uint256);

}
interface IForecasterReputation{
    function getLTV(address user) external view returns (uint256);

}
contract PositionVault is ReentrancyGuard, ERC1155Holder{
    event Deposited(address indexed lender, uint256 amount);
    event Withdrawn(address indexed lender, uint256 amount);
    event Borrowed(address indexed lender, uint256 marketId, bool isYes, uint256 shares, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator);
    using SafeERC20 for IERC20;
    IpmAMM public amm;
    IForecasterReputation public reputation;
    IERC20 public collateral;
    uint256 public constant WAD= 1e18;
    uint256 public constant BASE_RATE=5e14;
    uint256 public constant SLOPE_RATE= 2e15;
    uint256 public constant LIQ_THRESHOLD= 85;
    uint256 public constant LIQ_BONUS= 500;
    uint256 public interestIndex= WAD;
    uint256 public lastUpdatedBlock;
    uint256 public totalBorrowed;
    uint256 public totalDeposited;
    struct Loan{
        uint256 principal;
        uint256 interestIndex;
        uint256 shareAmount;
        uint256 marketId;
        bool isYes;
        bool active;
    }
    mapping(address=> Loan) public loans;
    mapping(address=>uint256) public lenderShares;
    uint256 public totalLenderShares;
    constructor(address _amm, address _reputation, address _collateral){
        amm= IpmAMM(_amm);
        reputation=IForecasterReputation(_reputation);
        collateral=IERC20(_collateral);
        lastUpdatedBlock=block.number;
    }
    function _accrueInterest() internal{
        if(block.number<=lastUpdatedBlock) return;
        if(totalBorrowed==0){
            lastUpdatedBlock=block.number;
            return;
        }
        uint256 elapsed = block.number-lastUpdatedBlock;
        uint256 utilization= totalDeposited==0? 0:(totalBorrowed*WAD)/totalDeposited;
        uint256 rate= BASE_RATE+(utilization*SLOPE_RATE/WAD);
        uint256 interest= (totalBorrowed*rate*elapsed)/(1000*WAD);
        totalDeposited+=interest;
        interestIndex+=(interestIndex*rate*elapsed)/(1000*WAD);
        lastUpdatedBlock=block.number;
    }
    function deposit(uint256 amount) external nonReentrant{
        _accrueInterest();
        require(amount>0,"Vault: zero deposit");
        uint256 shares= totalLenderShares==0 || totalDeposited==0? amount: (amount*totalLenderShares)/totalDeposited;
        totalDeposited+=amount;
        totalLenderShares+=shares;
        lenderShares[msg.sender]+=shares;
        collateral.safeTransferFrom(msg.sender, address(this),amount);
        emit Deposited(msg.sender,amount);
    }
    function withdraw(uint256 shareAmount) external nonReentrant{
        _accrueInterest();
        require(lenderShares[msg.sender]>=shareAmount,"Vault: not enough shares");
        require(totalLenderShares>0,"Vault: no shares");
        uint256 amount=(shareAmount*totalDeposited)/totalLenderShares;
        totalDeposited-=amount;
        totalLenderShares-=shareAmount;
        lenderShares[msg.sender]-=shareAmount;
        collateral.safeTransfer(msg.sender,amount);
        emit Withdrawn(msg.sender,amount);
    }
    function borrow(uint256 marketId, bool isYes, uint256 shareAmount, uint256 borrowAmount) external nonReentrant{
        _accrueInterest();
        require(!loans[msg.sender].active, "Vault: loan already open");
        require(shareAmount>0, "Vault: zero shares");
        require(borrowAmount>0, "Vault: zero borrow");
        uint256 price= amm.currentPrice(marketId);
        uint256 posPrice= isYes? price: (WAD-price);
        uint256 positionValue= (shareAmount*posPrice)/WAD;
        uint256 maxLtvPct= reputation.getLTV(msg.sender);
        uint256 maxBorrow= (positionValue*maxLtvPct)/100;
        require(borrowAmount<=maxBorrow,"Vault: exceeds LTV");
        require(borrowAmount<=totalDeposited-totalBorrowed,"Vault: insufficient liquidity");
        uint256 tokenId=isYes?amm.yesTokenId(marketId):amm.noTokenId(marketId);
        IERC1155(address(amm)).safeTransferFrom(msg.sender,address(this),tokenId, shareAmount, "");
        totalBorrowed+=borrowAmount;
        loans[msg.sender]=Loan({principal:borrowAmount, interestIndex:interestIndex,shareAmount:shareAmount,marketId:marketId, isYes:isYes, active:true});
        collateral.safeTransfer(msg.sender, borrowAmount);
        emit Borrowed(msg.sender, marketId, isYes, shareAmount, borrowAmount);   
    }
    function repay(uint256 amount) external nonReentrant{
        _accrueInterest();
        Loan storage l=loans[msg.sender];
        require(l.active,"Vault: no active loan");

        uint256 totalOwed= (l.principal*interestIndex)/l.interestIndex;
        uint256 repayAmount= amount>totalOwed? totalOwed:amount;

        bool fullRepay= repayAmount>=totalOwed;
        if(fullRepay){
            totalBorrowed -= l.principal;
            l.active=false;
        }
        else{
            uint256 newPrincipal = totalOwed - repayAmount;
            totalBorrowed = totalBorrowed - l.principal + newPrincipal;
            l.principal= newPrincipal;
            l.interestIndex=interestIndex;
        }

        collateral.safeTransferFrom(msg.sender,address(this),repayAmount);

        if(fullRepay){
            uint256 tokenId= l.isYes?amm.yesTokenId(l.marketId):amm.noTokenId(l.marketId);
            IERC1155(address(amm)).safeTransferFrom(address(this),msg.sender,tokenId,l.shareAmount,"");
        }
        emit Repaid(msg.sender,repayAmount);

    }

    function liquidate(address borrower) external nonReentrant{
        _accrueInterest();
        Loan storage l=loans[borrower];
        require(l.active, "Vault: no active loan");

        uint256 price= amm.currentPrice(l.marketId);
        uint256 posPrice= l.isYes? price: (WAD-price);
        uint256 positionValue= (l.shareAmount*posPrice)/WAD;

        uint256 totalOwed= (l.principal*interestIndex)/l.interestIndex;

        require(positionValue*100<totalOwed*LIQ_THRESHOLD,"Vault: not liquidatable");

        totalBorrowed-=l.principal;
        l.active=false;

        collateral.safeTransferFrom(msg.sender,address(this),totalOwed);

        uint256 tokenId=l.isYes?amm.yesTokenId(l.marketId):amm.noTokenId(l.marketId);
        IERC1155(address(amm)).safeTransferFrom(address(this),msg.sender,tokenId, l.shareAmount,"");

        emit Liquidated(borrower,msg.sender);

    }

    function outstandingOwed(address borrower) external view returns (uint256){
        Loan storage l= loans[borrower];
        if(!l.active) return 0;
        return (l.principal*interestIndex)/l.interestIndex;
    }
}
