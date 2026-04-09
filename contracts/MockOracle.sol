// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOracle {
    struct Price {
        uint256 price;
        uint256 timestamp;
        uint64 height;
        uint64 nonce;
        uint64 decimal;
        uint64 id;
    }
    mapping(string => Price) public prices;

    /// @notice Call this to simulate an oracle price.
    ///         e.g. setPrice("INIT/USD", 2500000) = $2.50 with 6 decimals
    function setPrice(string calldata pair, uint256 price) external {
        prices[pair] = Price(
            price,
            block.timestamp,
            uint64(block.number),
            0,
            6,
            0
        );
    }

    function get_price(
        string calldata pair_id
    ) external view returns (Price memory) {
        return prices[pair_id];
    }
}

