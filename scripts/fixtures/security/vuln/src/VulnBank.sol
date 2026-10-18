// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Deliberately vulnerable test fixture for the Gully Security engine. Never deploy.
contract VulnBank {
    mapping(address => uint256) public balances;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // Reentrancy: the external call happens before the balance is cleared.
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing to withdraw");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
        balances[msg.sender] = 0;
    }

    // Unchecked low-level call: the return value is ignored.
    function sweep(address payable to) external {
        require(tx.origin == owner, "not owner");
        to.call{value: address(this).balance}("");
    }
}
