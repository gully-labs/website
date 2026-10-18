// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Testnet-only mock of Ethereum mainnet USDT's ERC-20 shape: `transfer`, `transferFrom` and `approve` return
/// nothing (no bool), and `approve` refuses to change a non-zero allowance to another non-zero value (USDT's
/// race-condition guard, which is why Gully Pay's page resets the allowance to 0 first). Anyone can mint.
/// Used only by script/LiveFeeProxy.s.sol on Base Sepolia to exercise the proxy's no-return-value path.
contract MockUSDT {
    string public constant name = "Mock Tether USD (testnet)";
    string public constant symbol = "mUSDT";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 value) external {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function transfer(address to, uint256 value) external {
        _move(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _move(from, to, value);
    }

    function approve(address spender, uint256 value) external {
        require(value == 0 || allowance[msg.sender][spender] == 0, "reset to 0 first");
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function _move(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
