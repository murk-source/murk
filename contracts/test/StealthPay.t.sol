// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {StealthPay} from "../src/StealthPay.sol";

contract Tok is ERC20 {
    constructor() ERC20("Test", "TST") {
        _mint(msg.sender, 1e24);
    }
}

contract StealthPayTest is Test {
    StealthPay sp;
    Tok tok;
    address payer = address(0xA11CE);
    address stealth = address(0x5EA1);
    bytes eph = abi.encodePacked(bytes1(0x02), bytes32(uint256(7)));
    bytes meta = abi.encodePacked(bytes1(0x02), bytes32(uint256(1)), bytes1(0x03), bytes32(uint256(2)));

    function setUp() public {
        sp = new StealthPay();
        tok = new Tok();
        tok.transfer(payer, 1e21);
        vm.deal(payer, 10 ether);
    }

    function test_names() public {
        vm.prank(payer);
        sp.setName("alice_1", meta);
        (address o, bytes memory m) = sp.lookup("alice_1");
        assertEq(o, payer);
        assertEq(m, meta);
        // someone else cannot take it
        vm.expectRevert(StealthPay.Taken.selector);
        sp.setName("alice_1", meta);
        // the owner can update it
        bytes memory meta2 = abi.encodePacked(bytes1(0x03), bytes32(uint256(9)), bytes1(0x02), bytes32(uint256(8)));
        vm.prank(payer);
        sp.setName("alice_1", meta2);
        (, m) = sp.lookup("alice_1");
        assertEq(m, meta2);
    }

    function test_badNames() public {
        vm.expectRevert(StealthPay.BadName.selector);
        sp.setName("Al", meta);
        vm.expectRevert(StealthPay.BadName.selector);
        sp.setName("Alice", meta);
        vm.expectRevert(StealthPay.BadName.selector);
        sp.setName("a-b-c", meta);
        vm.expectRevert(StealthPay.BadKey.selector);
        sp.setName("alice", hex"0102");
    }

    function test_payNative() public {
        vm.recordLogs();
        vm.prank(payer);
        sp.payNative{value: 1 ether}(stealth, eph, bytes1(0xab));
        assertEq(stealth.balance, 1 ether);
        assertEq(address(sp).balance, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(stealth))));
        (bytes memory e, bytes memory md) = abi.decode(logs[0].data, (bytes, bytes));
        assertEq(e, eph);
        assertEq(md.length, 57);
        assertEq(uint8(md[0]), 0xab);
    }

    function test_payToken_withGas() public {
        vm.startPrank(payer);
        tok.approve(address(sp), 500e18);
        sp.payToken{value: 0.001 ether}(address(tok), 500e18, stealth, eph, bytes1(0x01));
        vm.stopPrank();
        assertEq(tok.balanceOf(stealth), 500e18);
        assertEq(stealth.balance, 0.001 ether);
        assertEq(tok.balanceOf(address(sp)), 0);
        assertEq(address(sp).balance, 0);
    }

    function test_rejects() public {
        vm.startPrank(payer);
        vm.expectRevert(StealthPay.NothingSent.selector);
        sp.payNative(stealth, eph, bytes1(0));
        vm.expectRevert(StealthPay.BadKey.selector);
        sp.payNative{value: 1}(stealth, hex"04", bytes1(0));
        vm.expectRevert(StealthPay.NothingSent.selector);
        sp.payToken(address(tok), 0, stealth, eph, bytes1(0));
        vm.stopPrank();
    }
}
