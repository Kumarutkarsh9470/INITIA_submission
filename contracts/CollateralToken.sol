// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract CollateralToken is ERC20, Ownable {
    
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 1e18;
    
    constructor(address treasury) ERC20("SignalUSD", "sUSD") Ownable(msg.sender) {
        _mint(treasury, INITIAL_SUPPLY);
    }
    
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}