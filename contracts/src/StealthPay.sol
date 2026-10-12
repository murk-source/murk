// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title StealthPay
/// @notice Stealth payments (ERC-5564, scheme 1: secp256k1 with view tags) plus a name registry for stealth
/// meta-addresses (two compressed public keys: spending, viewing).
///
/// A payer derives a one-time address for the receiver in the browser and pays through this contract. The contract
/// moves the money straight to that address in the same call and announces the ephemeral public key, so only the
/// receiver (who holds the viewing key) can tell that the payment is theirs and only they can spend it.
///
/// No owner, no fee, no admin function. The contract never holds funds after a call.
contract StealthPay {
    using SafeERC20 for IERC20;

    uint256 public constant SCHEME_ID = 1;
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @dev ERC-5564 announcement. metadata = viewTag (1) | selector (4) | token (20) | amount (32)
    event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata);
    event NameSet(bytes32 indexed nameHash, string name, address indexed owner, bytes metaAddress);

    struct Entry {
        address owner;
        bytes meta;
    }

    mapping(bytes32 => Entry) private names;

    error BadName();
    error BadKey();
    error Taken();
    error NothingSent();
    error SendFailed();

    // ---------- names ----------

    /// @notice Claims a name (3-20 chars: a-z, 0-9, _) for a stealth meta-address, or updates it if you own it.
    function setName(string calldata name, bytes calldata meta) external {
        _checkName(name);
        if (meta.length != 66 || (meta[0] != 0x02 && meta[0] != 0x03) || (meta[33] != 0x02 && meta[33] != 0x03)) revert BadKey();
        bytes32 h = keccak256(bytes(name));
        Entry storage e = names[h];
        if (e.owner != address(0) && e.owner != msg.sender) revert Taken();
        e.owner = msg.sender;
        e.meta = meta;
        emit NameSet(h, name, msg.sender, meta);
    }

    function lookup(string calldata name) external view returns (address owner, bytes memory meta) {
        Entry storage e = names[keccak256(bytes(name))];
        return (e.owner, e.meta);
    }

    // ---------- payments ----------

    /// @notice Pays native coin (ETH / BNB) to a one-time address and announces it.
    function payNative(address stealth, bytes calldata ephemeralPubKey, bytes1 viewTag) external payable {
        if (msg.value == 0) revert NothingSent();
        _checkKey(ephemeralPubKey);
        _send(stealth, msg.value);
        emit Announcement(SCHEME_ID, stealth, msg.sender, ephemeralPubKey, abi.encodePacked(viewTag, bytes4(0xeeeeeeee), NATIVE, msg.value));
    }

    /// @notice Pays an ERC-20 (approved to this contract first) to a one-time address and announces it.
    /// Any native coin sent along goes to the same address, so it can pay its own gas when the receiver collects.
    function payToken(address token, uint256 amount, address stealth, bytes calldata ephemeralPubKey, bytes1 viewTag) external payable {
        if (amount == 0) revert NothingSent();
        _checkKey(ephemeralPubKey);
        IERC20(token).safeTransferFrom(msg.sender, stealth, amount);
        if (msg.value > 0) _send(stealth, msg.value);
        emit Announcement(SCHEME_ID, stealth, msg.sender, ephemeralPubKey, abi.encodePacked(viewTag, IERC20.transferFrom.selector, token, amount));
    }

    // ---------- internals ----------

    function _send(address to, uint256 value) private {
        (bool ok,) = to.call{value: value}("");
        if (!ok) revert SendFailed();
    }

    function _checkKey(bytes calldata k) private pure {
        if (k.length != 33 || (k[0] != 0x02 && k[0] != 0x03)) revert BadKey();
    }

    function _checkName(string calldata name) private pure {
        bytes memory b = bytes(name);
        if (b.length < 3 || b.length > 20) revert BadName();
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_")) revert BadName();
        }
    }
}
