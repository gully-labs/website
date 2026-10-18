// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

/// TESTNET ONLY. Deploys Request Network's ERC20FeeProxy and EthereumFeeProxy (vendored verbatim in src/request from
/// RequestNetwork/requestNetwork @ 8110c4c7b5a70750ba44f808c4eb7224d7df4f98, MIT) plus the MockUSDT test token, then
/// checks that each proxy's runtime code, metadata stripped, is exactly what Request deployed on Base mainnet
/// (ERC20FeeProxy 0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814, EthereumFeeProxy 0xd9C3889eB8DA6ce449bfFE3cd194d08A436e96f2).
/// The hashes below are keccak256 of those mainnet runtimes without their CBOR metadata, read with eth_getCode.
///
///   forge script script/DeployFeeProxy.s.sol --rpc-url https://sepolia.base.org --private-key $TESTNET_PK --broadcast
///
/// It refuses to run on any chain but Base Sepolia (84532) or a local anvil (31337).
contract DeployFeeProxy is Script {
    bytes32 constant BASE_ERC20_FEE_PROXY_RUNTIME = 0xf046d2f7d0f32b2f0961c5e03bc98378dcdbfa214ce9e769e3c95602d6bdf06d; // 2112 bytes
    bytes32 constant BASE_ETH_FEE_PROXY_RUNTIME = 0x392288074378dcb2abe6c155be6982c28f59b6822cb1c8fe13bd4728ec73f380; // 2302 bytes

    function run() external returns (address erc20Proxy, address ethProxy, address mockUsdt) {
        require(block.chainid == 84532 || block.chainid == 31337, "testnet only: Base Sepolia (84532) or anvil");
        vm.startBroadcast();
        erc20Proxy = deployCode("ERC20FeeProxy.sol:ERC20FeeProxy");
        ethProxy = deployCode("EthereumFeeProxy.sol:EthereumFeeProxy");
        mockUsdt = deployCode("MockUSDT.sol:MockUSDT");
        vm.stopBroadcast();
        require(strippedHash(erc20Proxy.code) == BASE_ERC20_FEE_PROXY_RUNTIME, "ERC20FeeProxy differs from Base mainnet");
        require(strippedHash(ethProxy.code) == BASE_ETH_FEE_PROXY_RUNTIME, "EthereumFeeProxy differs from Base mainnet");
        console2.log("ERC20FeeProxy   ", erc20Proxy);
        console2.log("EthereumFeeProxy", ethProxy);
        console2.log("MockUSDT        ", mockUsdt);
    }

    /// keccak256 of runtime code without the trailing CBOR metadata (its length is the last two bytes).
    function strippedHash(bytes memory code) internal pure returns (bytes32 h) {
        uint256 n = code.length;
        uint256 meta = (uint256(uint8(code[n - 2])) << 8) | uint256(uint8(code[n - 1]));
        uint256 keep = n - meta - 2;
        assembly {
            h := keccak256(add(code, 32), keep)
        }
    }
}
