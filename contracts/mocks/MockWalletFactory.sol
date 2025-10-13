// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockWalletFactory {
  address[] private _users;
  mapping(address => address[]) private _userWallets;

  function addUser(address user) external {
    _users.push(user);
  }

  function addWallet(address user, address wallet) external {
    _userWallets[user].push(wallet);
  }

  function getUsers() external view returns (address[] memory) {
    return _users;
  }

  function getUserWallets(address user) external view returns (address[] memory) {
    return _userWallets[user];
  }
}


