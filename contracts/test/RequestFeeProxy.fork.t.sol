// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";

/// Request Network ERC20FeeProxy (deployed, immutable, no owner). Source: RequestNetwork/requestNetwork,
/// packages/smart-contracts/src/contracts/ERC20FeeProxy.sol.
interface IERC20FeeProxy {
    event TransferWithReferenceAndFee(
        address tokenAddress, address to, uint256 amount, bytes indexed paymentReference, uint256 feeAmount, address feeAddress
    );

    function transferFromWithReferenceAndFee(
        address tokenAddress,
        address to,
        uint256 amount,
        bytes calldata paymentReference,
        uint256 feeAmount,
        address feeAddress
    ) external;
}

/// Request Network EthereumFeeProxy (native coin).
interface IEthereumFeeProxy {
    function transferWithReferenceAndFee(address payable to, bytes calldata paymentReference, uint256 feeAmount, address payable feeAddress)
        external
        payable;
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

/// Shared checks, run once per chain against live state (fork at the latest block).
abstract contract RequestFeeProxyFork is Test {
    // Safe v1.4.1 canonical deployments (safe-global/safe-deployments), same address on every chain.
    address constant SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address constant SAFE_L2_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;

    bytes32 constant TOPIC_ERC20 = keccak256("TransferWithReferenceAndFee(address,address,uint256,bytes,uint256,address)");
    bytes32 constant TOPIC_NATIVE = keccak256("TransferWithReferenceAndFee(address,uint256,bytes,uint256,address)");

    address payer = makeAddr("payer");
    address merchant = makeAddr("merchant");
    address eoaTreasury = makeAddr("eoa-treasury");
    address safeTreasury;

    function rpcEnv() internal pure virtual returns (string memory);
    function rpcDefault() internal pure virtual returns (string memory);
    function chainId() internal pure virtual returns (uint256);
    function erc20Proxy() internal pure virtual returns (address);
    function nativeProxy() internal pure virtual returns (address);

    function setUp() public virtual {
        vm.createSelectFork(vm.envOr(rpcEnv(), rpcDefault()));
        assertEq(block.chainid, chainId(), "wrong chain");
        assertGt(erc20Proxy().code.length, 0, "ERC20FeeProxy not deployed");
        assertGt(nativeProxy().code.length, 0, "EthereumFeeProxy not deployed");
        // A real 1-of-1 Safe as the treasury, created in its own transaction so later calls find it cold.
        address[] memory owners = new address[](1);
        owners[0] = makeAddr("safe-owner");
        bytes memory init = abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners, 1, address(0), "", address(0), address(0), 0, address(0)
        );
        safeTreasury = ISafeProxyFactory(SAFE_FACTORY).createProxyWithNonce(SAFE_L2_SINGLETON, init, uint256(keccak256("gully")));
        vm.deal(payer, 100 ether);
    }

    // -------------------------------------------------------------- ERC-20

    /// Pays `amount` (merchant) + `fee` (Safe treasury) with one call; checks balances, the event and no custody.
    function _payToken(address proxy, address token, uint256 amount, uint256 fee) internal {
        deal(token, payer, amount + fee);
        vm.prank(payer);
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", proxy, amount + fee));
        assertTrue(ok, "approve");

        bytes memory ref = hex"9f1c2a7be04d33aa"; // 8 bytes, as Gully Pay sends
        uint256 m0 = IERC20(token).balanceOf(merchant);
        uint256 t0 = IERC20(token).balanceOf(safeTreasury);
        uint256 p0 = IERC20(token).balanceOf(proxy);

        vm.recordLogs();
        vm.prank(payer);
        IERC20FeeProxy(proxy).transferFromWithReferenceAndFee(token, merchant, amount, ref, fee, safeTreasury);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(IERC20(token).balanceOf(merchant) - m0, amount, "merchant got amount");
        assertEq(IERC20(token).balanceOf(safeTreasury) - t0, fee, "Safe treasury got fee");
        assertEq(IERC20(token).balanceOf(proxy), p0, "proxy holds nothing");
        assertEq(IERC20(token).balanceOf(payer), 0, "payer paid amount + fee");

        _checkLog(logs[logs.length - 1], proxy, token, amount, fee, ref);
    }

    /// The receipt the server decodes: topic0, topic1 = keccak(reference), data = (token, to, amount, fee, feeAddress)
    function _checkLog(Vm.Log memory l, address proxy, address token, uint256 amount, uint256 fee, bytes memory ref) internal view {
        assertEq(l.emitter, proxy);
        assertEq(l.topics.length, 2);
        assertEq(l.topics[0], TOPIC_ERC20);
        assertEq(l.topics[1], keccak256(ref));
        (address t, address to, uint256 a, uint256 f, address fa) = abi.decode(l.data, (address, address, uint256, uint256, address));
        assertEq(t, token);
        assertEq(to, merchant);
        assertEq(a, amount);
        assertEq(f, fee);
        assertEq(fa, safeTreasury);
    }

    function _zeroFeeSkipsTreasury(address proxy, address token) internal {
        deal(token, payer, 1e6);
        vm.prank(payer);
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", proxy, 1e6));
        assertTrue(ok);
        vm.prank(payer);
        IERC20FeeProxy(proxy).transferFromWithReferenceAndFee(token, merchant, 1e6, hex"01", 0, safeTreasury);
        assertEq(IERC20(token).balanceOf(merchant), 1e6);
        assertEq(IERC20(token).balanceOf(safeTreasury), 0);
    }

    function _revertsWithoutAllowance(address proxy, address token) internal {
        deal(token, payer, 1e6);
        vm.prank(payer);
        vm.expectRevert();
        IERC20FeeProxy(proxy).transferFromWithReferenceAndFee(token, merchant, 1e6, hex"01", 0, safeTreasury);
    }

    // -------------------------------------------------------------- native coin

    /// The finding that keeps native coin off the proxy: the fee leg uses Solidity `transfer` (2300 gas),
    /// which a Safe proxy cannot accept (cold SLOAD of its singleton + cold DELEGATECALL > 2300 gas).
    function test_native_feeToSafeTreasury_reverts() public {
        vm.prank(payer);
        vm.expectRevert();
        IEthereumFeeProxy(nativeProxy()).transferWithReferenceAndFee{value: 1 ether}(
            payable(merchant), hex"9f1c2a7be04d33aa", 0.005 ether, payable(safeTreasury)
        );
    }

    function test_native_feeToEoa_works() public {
        vm.recordLogs();
        vm.prank(payer);
        IEthereumFeeProxy(nativeProxy()).transferWithReferenceAndFee{value: 1 ether}(
            payable(merchant), hex"9f1c2a7be04d33aa", 0.005 ether, payable(eoaTreasury)
        );
        assertEq(merchant.balance, 0.995 ether);
        assertEq(eoaTreasury.balance, 0.005 ether);
        assertEq(nativeProxy().balance, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs[logs.length - 1].topics[0], TOPIC_NATIVE);
    }

    function test_safeReceivesNativeByPlainTransfer() public {
        // Plain coin transfers (the QR / EIP-681 path) to a Safe forward all gas and work.
        vm.prank(payer);
        (bool ok,) = safeTreasury.call{value: 0.01 ether}("");
        assertTrue(ok);
        assertEq(safeTreasury.balance, 0.01 ether);
    }
}

contract BaseFork is RequestFeeProxyFork {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function rpcEnv() internal pure override returns (string memory) { return "GULLY_RPC_8453"; }
    function rpcDefault() internal pure override returns (string memory) { return "https://base-rpc.publicnode.com"; }
    function chainId() internal pure override returns (uint256) { return 8453; }
    function erc20Proxy() internal pure override returns (address) { return 0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814; }
    function nativeProxy() internal pure override returns (address) { return 0xd9C3889eB8DA6ce449bfFE3cd194d08A436e96f2; }

    function test_usdc() public { _payToken(erc20Proxy(), USDC, 99.5e6, 0.5e6); }
    function test_usdc_zeroFee() public { _zeroFeeSkipsTreasury(erc20Proxy(), USDC); }
    function test_usdc_noAllowance() public { _revertsWithoutAllowance(erc20Proxy(), USDC); }
}

contract EthereumFork is RequestFeeProxyFork {
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    /// The 0.2.0 address Request's own SDK uses on Ethereum (solc 0.5.17 build of the same source).
    address constant ERC20_FEE_PROXY_V020 = 0x370DE27fdb7D1Ff1e1BaA7D11c5820a324Cf623C;

    function rpcEnv() internal pure override returns (string memory) { return "GULLY_RPC_1"; }
    function rpcDefault() internal pure override returns (string memory) { return "https://eth.drpc.org"; }
    function chainId() internal pure override returns (uint256) { return 1; }
    /// The 0.8.4 build, byte-identical to Arbitrum and BNB (Request's "0.2.0-next" mainnet deployment).
    function erc20Proxy() internal pure override returns (address) { return 0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9; }
    function nativeProxy() internal pure override returns (address) { return 0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8; }

    function test_usdc() public { _payToken(erc20Proxy(), USDC, 99.5e6, 0.5e6); }
    function test_usdt_noReturnValue() public { _payToken(erc20Proxy(), USDT, 99.5e6, 0.5e6); }
    function test_usdc_v020() public { _payToken(ERC20_FEE_PROXY_V020, USDC, 99.5e6, 0.5e6); }
    function test_usdt_v020() public { _payToken(ERC20_FEE_PROXY_V020, USDT, 99.5e6, 0.5e6); }
    function test_usdt_zeroFee() public { _zeroFeeSkipsTreasury(erc20Proxy(), USDT); }
    function test_usdt_noAllowance() public { _revertsWithoutAllowance(erc20Proxy(), USDT); }
}

contract BnbFork is RequestFeeProxyFork {
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;

    function rpcEnv() internal pure override returns (string memory) { return "GULLY_RPC_56"; }
    function rpcDefault() internal pure override returns (string memory) { return "https://bsc-dataseed.bnbchain.org"; }
    function chainId() internal pure override returns (uint256) { return 56; }
    function erc20Proxy() internal pure override returns (address) { return 0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9; }
    function nativeProxy() internal pure override returns (address) { return 0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8; }

    function test_usdt() public { _payToken(erc20Proxy(), USDT, 99.5e18, 0.5e18); }
    function test_usdc() public { _payToken(erc20Proxy(), USDC, 99.5e18, 0.5e18); }
    function test_usdt_zeroFee() public { _zeroFeeSkipsTreasury(erc20Proxy(), USDT); }
}

contract ArbitrumFork is RequestFeeProxyFork {
    address constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    function rpcEnv() internal pure override returns (string memory) { return "GULLY_RPC_42161"; }
    function rpcDefault() internal pure override returns (string memory) { return "https://arbitrum-one-rpc.publicnode.com"; }
    function chainId() internal pure override returns (uint256) { return 42161; }
    function erc20Proxy() internal pure override returns (address) { return 0x0DfbEe143b42B41eFC5A6F87bFD1fFC78c2f0aC9; }
    function nativeProxy() internal pure override returns (address) { return 0xfCFBcfc4f5A421089e3Df45455F7f4985FE2D6a8; }

    function test_usdc() public { _payToken(erc20Proxy(), USDC, 99.5e6, 0.5e6); }
    function test_usdc_zeroFee() public { _zeroFeeSkipsTreasury(erc20Proxy(), USDC); }
    function test_usdc_noAllowance() public { _revertsWithoutAllowance(erc20Proxy(), USDC); }
}
